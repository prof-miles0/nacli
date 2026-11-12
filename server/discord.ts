// Posts problems to a Discord channel through a webhook ([[discord]]), one
// notifier per webhook: the alerts the Status page shows, the RotomNG devices
// that stay disconnected, and those with free workers while their Dragonite
// is short of them. Each problem is posted when it starts and when it ends
// (and again every remind_every, if set), never on every check.

import type { WatchdogEvent } from "../shared/types.ts";
import type { DiscordConfig, DiscordSend } from "./config.ts";

export interface Problem {
  key: string;
  kind: DiscordSend;
  level: "critical" | "warning";
  subject: string;
  text: string;
  /** Its page in Nacli, linked when [server] public_url is set. */
  to?: string;
  /** The [[stack]] it belongs to, for webhooks with `stacks` (none: Golbat, Zapdos…). */
  stack?: string;
  /** The Help step that explains it, linked as a second button. */
  help?: string;
  /** Devices: since when it has been so (ms), for each webhook's own wait. */
  since?: number;
}

/** A problem already posted, kept in state_file so a restart does not post it again. */
export interface PostedProblem extends Problem {
  /** When it was first posted (ms). */
  since: number;
  /** When it was last posted, first time or reminder (ms). */
  lastSent: number;
}

/** A problem is posted once two checks in a row see it, and over once two in a row don't: a blip says nothing. */
const CONFIRM = 2;
/** Discord's limit of components in one message, nested ones included. */
const COMPONENTS_PER_MESSAGE = 40;
const COLORS = { critical: 0xef4444, warning: 0xf59e0b, resolved: 0x22c55e, info: 0x5865f2, watchdog: 0x3b82f6 };
/** The webhook's picture: Nacli's logo, from the public repository so it shows wherever Nacli runs. */
const AVATAR = "https://raw.githubusercontent.com/prof-miles0/nacli/main/web/public/nacli.png";
/** Components V2: containers, text and buttons instead of content and embeds. */
const IS_COMPONENTS_V2 = 1 << 15;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Text as Discord shows it literally: no markdown, mentions or links of its own. */
const plain = (s: string) => s.replace(/([\\*_~`|>#\[\]()-])/g, "\\$1").replace(/@/g, "@\u200b");
/** A time each reader sees in their own time zone: "R" relative, "f" date and time. */
const stamp = (ms: number, style: "R" | "f" = "R") => `<t:${Math.floor(ms / 1000)}:${style}>`;

function since(ms: number) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days`;
}

type Component = Record<string, unknown> & { type: number };
/** A message part: one problem or event, as a coloured card with its buttons. */
interface Card {
  color: number;
  /** Small line on top: what happened, and the stack. */
  kicker: string;
  title: string;
  body: string;
  /** Small line at the bottom: when. */
  footer?: string;
  links: { label: string; url: string; emoji?: string }[];
}

const count = (c: Component): number =>
  1 + ((c.components as Component[] | undefined) ?? []).reduce((n, x) => n + count(x), 0) + (c.accessory ? 1 : 0);

function card(c: Card): Component {
  const text = [`-# ${c.kicker}`, `### ${c.title}`, c.body, ...(c.footer ? [`-# ${c.footer}`] : [])].join("\n");
  return {
    type: 17,
    accent_color: c.color,
    components: [
      { type: 10, content: clip(text, 3800) },
      ...(c.links.length
        ? [
            {
              type: 1,
              components: c.links.slice(0, 5).map((l) => ({ type: 2, style: 5, label: clip(l.label, 80), url: l.url, ...(l.emoji ? { emoji: { name: l.emoji } } : {}) })),
            },
          ]
        : []),
    ],
  };
}

export class DiscordNotifier {
  private posted = new Map<string, PostedProblem>();
  /** Seen but not posted yet: how many checks in a row. */
  private seen = new Map<string, number>();
  /** Posted, but missing: how many checks in a row. */
  private missing = new Map<string, number>();
  private lastError?: string;

  constructor(
    private cfg: () => DiscordConfig | undefined,
    private title: () => string,
    private publicUrl: () => string | undefined,
  ) {}

  restore(list: PostedProblem[] | undefined) {
    for (const p of list ?? []) this.posted.set(p.key, p);
  }

  dump(): PostedProblem[] {
    return [...this.posted.values()];
  }

  /** The problems right now: posts the ones that started, ended or are due a reminder. */
  async check(now: Problem[]) {
    const cfg = this.cfg();
    if (!cfg) return;
    const t = Date.now();
    const current = new Map(now.map((p) => [p.key, p]));
    const started: Problem[] = [];
    const ended: PostedProblem[] = [];

    for (const p of current.values()) {
      const old = this.posted.get(p.key);
      this.missing.delete(p.key);
      if (old) {
        // Still on: keep its latest wording for the reminder and the end.
        this.posted.set(p.key, { ...old, ...p });
        continue;
      }
      const n = (this.seen.get(p.key) ?? 0) + 1;
      if (n < CONFIRM) {
        this.seen.set(p.key, n);
        continue;
      }
      this.seen.delete(p.key);
      started.push(p);
    }
    for (const k of this.seen.keys()) if (!current.has(k)) this.seen.delete(k);
    for (const [k, p] of this.posted) {
      if (current.has(k)) continue;
      const n = (this.missing.get(k) ?? 0) + 1;
      if (n < CONFIRM) {
        this.missing.set(k, n);
        continue;
      }
      this.missing.delete(k);
      ended.push(p);
    }
    const due = cfg.remindEveryMs
      ? [...this.posted.values()].filter((p) => current.has(p.key) && t - p.lastSent >= cfg.remindEveryMs)
      : [];
    if (!started.length && !ended.length && !due.length) return;

    const where = (p: Problem) => (p.stack ? ` · ${plain(p.stack)}` : "");
    const cards: Card[] = [
      ...started.map((p) => ({
        color: COLORS[p.level],
        kicker: `${p.level === "critical" ? "🔴 Critical" : "🟠 Warning"}${where(p)}`,
        title: plain(p.subject),
        body: plain(p.text),
        footer: `Since ${stamp(p.since ?? t)}`,
        links: this.links(p),
      })),
      ...ended.map((p) => ({
        color: COLORS.resolved,
        kicker: `✅ Back to normal${where(p)}`,
        title: plain(p.subject),
        body: `~~${plain(p.text)}~~`,
        footer: `Lasted ${since(t - p.since)} · ended ${stamp(t)}`,
        links: this.links(p),
      })),
      ...due.map((p) => ({
        color: COLORS[p.level],
        kicker: `⏰ Still going on${where(p)}`,
        title: plain(p.subject),
        body: plain(p.text),
        footer: `For ${since(t - p.since)} · since ${stamp(p.since, "f")}`,
        links: this.links(p),
      })),
    ];
    // A ping only for what just started; endings and reminders arrive quietly.
    const ok = await this.post(cfg, cards, started.length ? cfg.mention : undefined);
    // Unsent changes are tried again on the next check.
    if (!ok) return;
    for (const p of started) this.posted.set(p.key, { ...p, since: t, lastSent: t });
    for (const p of ended) this.posted.delete(p.key);
    for (const p of due) this.posted.set(p.key, { ...p, lastSent: t });
  }

  /**
   * The devices the watchdog restarted, at once: they are events, not
   * problems that start and end. Unsent ones are not tried again.
   */
  async restarts(events: WatchdogEvent[]) {
    const cfg = this.cfg();
    if (!cfg || !events.length) return;
    const base = this.publicUrl();
    const verb = (e: WatchdogEvent) => (e.action === "reboot" ? "rebooted" : "restarted");
    await this.post(
      cfg,
      events.map((e) => ({
        color: e.error ? COLORS.critical : COLORS.watchdog,
        kicker: `${e.error ? "❌ Watchdog failed" : e.dryRun ? "🧪 Watchdog · dry run" : "🔄 Watchdog"} · ${plain(e.stack)}`,
        title: `Device ${plain(e.device)} ${e.error ? `not ${verb(e)}` : e.dryRun ? `would be ${verb(e)}` : verb(e)}`,
        body: `${plain(e.reason[0].toUpperCase() + e.reason.slice(1))}.${e.error ? `\n**${plain(e.error)}**` : ""}`,
        footer: stamp(e.t),
        links: base
          ? [
              { label: "Devices", url: `${base}/devices`, emoji: "📱" },
              { label: "Workers", url: `${base}/workers`, emoji: "⚙️" },
            ]
          : [],
      })),
    );
  }

  /** A message to check the webhook works: what is open now, without posting it as new. */
  async test(open: Problem[]): Promise<void> {
    const cfg = this.cfg();
    if (!cfg) throw new Error("this webhook is no longer in config.toml");
    const base = this.publicUrl();
    const what = cfg.send.map((k) => (k === "alerts" && cfg.level === "critical" ? "critical alerts" : k)).join(", ");
    const list = open.slice(0, 10).map((p) => `- ${p.level === "critical" ? "🔴" : "🟠"} **${plain(p.subject)}** ${plain(p.text)}`);
    const ok = await this.post(cfg, [
      {
        color: COLORS.info,
        kicker: "🔗 Webhook connected",
        title: `${plain(this.title())} → ${plain(cfg.name)}`,
        body: [
          `Posts **${what}** for ${cfg.stacks ? `**${cfg.stacks.map(plain).join(", ")}**` : "**every stack**"}, when each problem starts and when it ends.`,
          "",
          open.length
            ? `**${open.length} problem${open.length === 1 ? "" : "s"} for this channel right now**\n${list.join("\n")}${open.length > 10 ? `\n-# and ${open.length - 10} more` : ""}`
            : "**No problems for this channel right now.**",
        ].join("\n"),
        footer: `Test message · ${stamp(Date.now())}`,
        links: base ? [{ label: "Status", url: `${base}/status`, emoji: "🚦" }, { label: "Help", url: `${base}/help#discord`, emoji: "📖" }] : [],
      },
    ]);
    if (!ok) throw new Error(this.lastError ?? "Discord did not take the message");
  }

  /** The buttons of a problem: its page and, for an alert, its Help step. Only with public_url. */
  private links(p: Problem): Card["links"] {
    const base = this.publicUrl();
    if (!base) return [];
    const out: Card["links"] = [];
    if (p.kind === "underused") {
      out.push({ label: "Workers", url: `${base}/workers`, emoji: "⚙️" }, { label: "Areas", url: `${base}/dragonite/areas`, emoji: "🗺️" });
    } else if (p.to) {
      out.push({ label: p.kind === "devices" ? "Devices" : "Open in Nacli", url: `${base}${p.to}`, emoji: p.kind === "devices" ? "📱" : "🔎" });
    }
    if (p.help) out.push({ label: "Help", url: `${base}/help#${p.help}`, emoji: "📖" });
    return out;
  }

  /** Sends the cards, as many per message as Discord takes; false when Discord refused one. */
  private async post(cfg: DiscordConfig, cards: Card[], mention?: string): Promise<boolean> {
    const parts = cards.map(card);
    // The ping is text of its own above the cards: Components V2 messages have no content.
    const ping: Component[] = mention ? [{ type: 10, content: mention }] : [];
    let batch: Component[] = [...ping];
    const batches: Component[][] = [];
    for (const c of parts) {
      if (batch.length > ping.length && batch.reduce((n, x) => n + count(x), 0) + count(c) > COMPONENTS_PER_MESSAGE) {
        batches.push(batch);
        batch = [];
      }
      batch.push(c);
    }
    if (batch.length) batches.push(batch);
    for (const components of batches) {
      const body = JSON.stringify({
        username: this.title(),
        avatar_url: AVATAR,
        flags: IS_COMPONENTS_V2,
        components,
        allowed_mentions: { parse: mention ? ["everyone", "roles", "users"] : [] },
      });
      if (!(await this.send(cfg.webhookUrl, body))) return false;
    }
    return true;
  }

  private async send(url: string, body: string, retried = false): Promise<boolean> {
    try {
      // Without it Discord drops the components of a webhook message.
      const target = new URL(url);
      target.searchParams.set("with_components", "true");
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      // Too many messages: Discord says how long to wait. Once, then the next check.
      if (res.status === 429 && !retried) {
        const wait = Number(((await res.json().catch(() => ({}))) as { retry_after?: number }).retry_after) || 2;
        await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
        return this.send(url, body, true);
      }
      if (!res.ok) {
        const msg = ((await res.json().catch(() => ({}))) as { message?: string }).message;
        return this.fail(`Discord answered HTTP ${res.status}${msg ? `: ${msg}` : ""}`);
      }
      if (this.lastError) console.log(`[discord] ${this.cfg()?.name ?? "webhook"}: posting again`);
      this.lastError = undefined;
      return true;
    } catch (e) {
      // The webhook's address is a secret: the log names the failure, never the URL.
      return this.fail(`could not reach Discord (${(e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message})`);
    }
  }

  private fail(msg: string) {
    if (msg !== this.lastError) console.error(`[discord] ${this.cfg()?.name ?? "webhook"}: ${msg}`);
    this.lastError = msg;
    return false;
  }
}
