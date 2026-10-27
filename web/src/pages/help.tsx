// Help: how to connect each part of the stack in config.toml, what is
// connected here now, and what the database account needs.

import { Check, Copy, Minus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router";
import type { AppInfo } from "@shared/types";
import { Card } from "@/components/ui";
import { useAppInfo } from "@/lib/state";
import { cn } from "@/lib/utils";

/** A config or SQL snippet, with a button that copies it. */
function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-xs leading-5">{children}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy"
        title="Copy"
        className="absolute top-1.5 right-1.5 grid size-7 cursor-pointer place-items-center rounded-md border bg-background/80 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 [&>svg]:size-3.5"
      >
        {copied ? <Check className="text-green-500" /> : <Copy />}
      </button>
    </div>
  );
}

const C = ({ children }: { children: ReactNode }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;

function Step({ n, id, title, children }: { n: number; id: string; title: string; children: ReactNode }) {
  return (
    <Card id={id} className="flex scroll-mt-32 flex-col gap-3 p-4 sm:p-5">
      <h2 className="flex items-center gap-2.5 text-base font-semibold">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-foreground tabular-nums">{n}</span>
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-sm leading-6 text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{children}</div>
    </Card>
  );
}

/** What this Nacli has connected now, from its config.toml. */
function Connected({ app }: { app: AppInfo }) {
  const zapdos = app.historySource === "zapdos" || app.dragonite.some((d) => d.fromVm);
  const withApi = app.dragonite.filter((d) => d.accounts);
  const withDb = app.dragonite.filter((d) => d.database);
  const rows: { label: string; on: boolean; detail: string }[] = [
    { label: "RotomNG", on: app.instances.length > 0, detail: app.instances.length ? app.instances.map((i) => i.name).join(", ") : "no [stack.rotom]" },
    {
      label: "Dragonite",
      on: withApi.length > 0,
      detail: app.dragonite.length ? `${withApi.length} of ${app.dragonite.length} with their API` : "no [stack.dragonite]",
    },
    { label: "Golbat API", on: app.golbatMap, detail: app.golbatMap ? "devices, Statistics" : "no url in [golbat]" },
    { label: "Zapdos", on: zapdos, detail: zapdos ? "charts up to 30 days" : "charts kept in memory" },
    { label: "Golbat database", on: app.golbatDb, detail: app.golbatDb ? "Spawnpoints, Encounters" : "no database in [golbat]" },
    {
      label: "Dragonite databases",
      on: withDb.length > 0,
      detail: withDb.length ? withDb.map((d) => d.name).join(", ") : "no database in [stack.dragonite]",
    },
    { label: "Map", on: !!app.map, detail: app.map ? "basemap set" : "no [map]: plain background" },
  ];
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-2 text-base font-semibold">Connected here</h2>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2.5 border-b border-border/40 py-1.5 text-sm last:border-0 sm:[&:nth-last-child(2)]:border-0">
            <span className={cn("grid size-4 shrink-0 place-items-center rounded-full [&>svg]:size-3", r.on ? "bg-green-500/15 text-green-500" : "bg-muted text-muted-foreground")}>
              {r.on ? <Check /> : <Minus />}
            </span>
            <span className="font-medium">{r.label}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">{r.detail}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const STEPS = [
  { id: "config", title: "The config.toml file" },
  { id: "stacks", title: "RotomNG and Dragonite" },
  { id: "golbat", title: "Golbat" },
  { id: "zapdos", title: "Zapdos" },
  { id: "database", title: "The database" },
  { id: "permissions", title: "Database permissions" },
  { id: "map", title: "The map" },
  { id: "check", title: "Check it works" },
];

/** A database name as SQL takes it: backquoted unless plain. */
const ident = (name: string) => (/^[A-Za-z0-9_]+$/.test(name) ? name : `\`${name.replace(/`/g, "``")}\``);

/** Step 6's SQL, with the user and databases from config.toml where set. */
function grants(app?: AppInfo) {
  const d = app?.databases;
  const user = d?.user || "nacli";
  const to = `'${user.replace(/'/g, "''")}'@'%'`;
  const golbat = ident(d?.golbat || "golbat");
  const dbs = d?.dragonite.length ? d.dragonite : [{ name: "", database: "dragonite" }];
  const per = (sql: (db: string) => string) => dbs.map((x) => `${sql(ident(x.database))}${x.name ? `  -- ${x.name}` : ""}`).join("\n");
  const dragonite = per((db) => `GRANT SELECT ON ${db}.* TO ${to};`);
  return {
    filled: !!(d?.user || d?.golbat || d?.dragonite.length),
    user,
    sql: `CREATE USER ${to} IDENTIFIED BY 'a-long-random-password';

-- Golbat: Spawnpoints and Encounters
GRANT SELECT ON ${golbat}.* TO ${to};

-- Each Dragonite with a database in config.toml
${dragonite}`,
    del: `GRANT DELETE ON ${golbat}.spawnpoint TO ${to};`,
    move: per((db) => `GRANT INSERT, DELETE ON ${db}.account TO ${to};`),
  };
}

export function HelpPage() {
  const { data: app } = useAppInfo();
  const g = grants(app);
  // Opened at a step (from a DB pill, say): bring it into view, also when already on this page.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: "smooth" });
  }, [hash, !!app]);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Help</h1>
        <p className="text-sm text-muted-foreground">How to connect each part of the stack to Nacli, and what the database account needs.</p>
      </div>

      {app ? <Connected app={app} /> : null}

      <nav aria-label="Steps" className="flex flex-wrap gap-1.5">
        {STEPS.map((s, i) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            {i + 1}. {s.title}
          </a>
        ))}
      </nav>

      <Step n={1} id="config" title="The config.toml file">
        <p>
          Everything is set in one <C>config.toml</C>, next to Nacli (in Docker, mounted at <C>/app/config.toml</C>). Start from{" "}
          <C>config.example.toml</C>: only <C>[server]</C> and one <C>[[users]]</C> are required, and each section you add enables the pages it
          allows.
        </p>
        <p>
          <b>Changes are picked up on save</b>, with no restart. If the file has a mistake, Nacli keeps the previous configuration and writes why in
          its log.
        </p>
        <p>
          Nacli must be able to reach every address you give it. In Docker, <C>localhost</C> is the container itself: use the host's IP or the
          service name on a shared network.
        </p>
      </Step>

      <Step n={2} id="stacks" title="RotomNG and Dragonite">
        <p>
          Add one <C>[[stack]]</C> per deployment: a Dragonite and the RotomNG it sends its controllers to. A stack can have both parts or only one.
        </p>
        <Code>{`[[stack]]
name = "Alpha"

[stack.rotom]
url = "http://10.0.0.10:7072"       # RotomNG's http_listener, without /api
api_secret = "..."                  # its http_listener.secret
zapdos_instance = "rotom-alpha"     # optional: its instance label in Zapdos

[stack.dragonite]
url = "http://10.0.0.10:7272"       # Dragonite's API, or its admin + "/api"
api_secret = "..."                  # optional: sent as X-Dragonite-Admin-Secret
zapdos_instance = "dragonite-alpha" # optional
database = "dragonite"              # optional: needs [database] (step 5)`}</Code>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>RotomNG</b>: the root of its <C>http_listener</C>, without <C>/api</C>, and its <C>secret</C>. Enables Instances, Devices, Workers,
            Jobs and Metrics.
          </li>
          <li>
            <b>Dragonite</b>: its own API (port <C>7272</C>) or its admin plus <C>/api</C>. Enables Accounts, Areas, Unbound Modes, Proxies,
            Scheduler and Status. Use Dragonite's own to also get its charts without Zapdos.
          </li>
          <li>
            A proxy in front takes <C>headers = {"{ ... }"}</C> or <C>basic_auth = {"{ username, password }"}</C> in either part.
          </li>
          <li>
            RotomNG has no database; each Dragonite can have its own (step 5).
          </li>
        </ul>
        <div id="stack-links" className="flex scroll-mt-32 flex-col gap-2">
          <p>
            <b>Which Rotom each Dragonite's controllers reach.</b> Every controller tells its Rotom which Dragonite it comes from, by the name
            Dragonite reports as its <C>instance</C> (or, without a <C>url</C>, the stack's <C>name</C>). Nacli expects each Dragonite's
            controllers on the RotomNG of its own <C>[[stack]]</C>, and warns when:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>no Rotom sees its controllers</b>: Dragonite is not connecting to any RotomNG here; check the RotomNG address in Dragonite's
              config and that it is running;
            </li>
            <li>
              <b>its controllers are on another stack's Rotom</b>: Dragonite points at the wrong RotomNG, or the two are in the wrong{" "}
              <C>[[stack]]</C> in <C>config.toml</C>;
            </li>
            <li>
              <b>controllers match no [[stack]]</b>: a Dragonite Nacli doesn't know uses this RotomNG; add its <C>[stack.dragonite]</C>, or give
              the stack the <C>name</C> Dragonite reports.
            </li>
          </ul>
        </div>
      </Step>

      <Step n={3} id="golbat" title="Golbat">
        <p>One Golbat, shared by every stack.</p>
        <Code>{`[golbat]
url = "http://10.0.0.20:9001"   # Golbat's API
api_secret = "..."              # its api_secret
zapdos_instance = "golbat"      # optional
stats_poll_interval = "5m"      # optional: keeps the Statistics' last 24 h
database = "golbat"             # optional: needs [database] (step 5)`}</Code>
        <p>
          With <C>url</C>: the devices on the Dashboard map and the Statistics page per Dragonite area. With <C>database</C>: the Spawnpoints and
          Encounters pages.
        </p>
      </Step>

      <Step n={4} id="zapdos" title="Zapdos">
        <p>
          Point Nacli at Zapdos' VictoriaMetrics (port <C>8428</C>) and charts come from there, up to 30 days. Each instance is matched by its{" "}
          <C>zapdos_instance</C>.
        </p>
        <Code>{`[zapdos]
url = "http://10.0.0.30:8428"
username = "vmuser"            # if it asks for Basic Auth
password = "..."`}</Code>
        <p>
          Without Zapdos, or for an instance with no data there, Nacli reads its metrics itself and keeps 24 h in memory. A warning shows when an
          instance has sent nothing to Zapdos for 30 minutes.
        </p>
      </Step>

      <Step n={5} id="database" title="The database">
        <p>
          The stack's MariaDB server is set once in <C>[database]</C>. Then each part names its own database on it: <C>database</C> in{" "}
          <C>[golbat]</C>, and <C>database</C> in each <C>[stack.dragonite]</C>.
        </p>
        <Code>{`[database]
host = "10.0.0.40"
port = 3306
username = "nacli"
password = "..."`}</Code>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Make MariaDB listen where Nacli can reach it: <C>bind-address</C> in its config (not only <C>127.0.0.1</C> when Nacli runs elsewhere),
            and port <C>3306</C> open from Nacli's host.
          </li>
          <li>Create an account just for Nacli and grant it what step 6 lists. Don't reuse Golbat's or Dragonite's own account.</li>
          <li>
            Add <C>[database]</C> and the <C>database</C> names to <C>config.toml</C>, and save.
          </li>
          <li>Check the DB pills in the sidebar (step 8).</li>
        </ol>
        <p>The server's address and the password never reach the browser; errors only say what went wrong.</p>
      </Step>

      <Step n={6} id="permissions" title="Database permissions">
        <p>
          <b>Reading is all Nacli needs</b>, so the account gets <C>SELECT</C> on each database it reads. Replace <C>'%'</C> with Nacli's IP to
          accept it only from there{g.filled ? "." : ", and the database names with yours."}
        </p>
        {g.filled ? (
          <p className="text-xs text-muted-foreground">Filled in with the user and databases in this config.toml; the rest are examples.</p>
        ) : null}
        <Code>{g.sql}</Code>
        <p>
          <b>Optional:</b> the Spawnpoints tool that deletes spawnpoints also needs <C>DELETE</C> on that one table. Without it the tool refuses.
        </p>
        <Code>{g.del}</Code>
        <p>
          <b>Optional:</b> moving accounts from one stack to another (Accounts › Move) takes their rows out of one Dragonite's{" "}
          <C>account</C> table and into the other's, so it needs <C>INSERT</C> and <C>DELETE</C> on <C>account</C> in every Dragonite
          database. Without them the move refuses. Nothing else in Nacli writes to the database.
        </p>
        <Code>{g.move}</Code>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-1.5 font-medium">Database</th>
                <th className="px-3 py-1.5 font-medium">Grant</th>
                <th className="px-3 py-1.5 font-medium">Tables read</th>
                <th className="px-3 py-1.5 font-medium">For</th>
              </tr>
            </thead>
            <tbody className="[&_td]:px-3 [&_td]:py-1.5 [&_tr]:border-t">
              <tr>
                <td>Golbat</td>
                <td>
                  <C>SELECT</C>
                </td>
                <td>
                  <C>spawnpoint</C>, <C>pokemon_area_stats</C>
                </td>
                <td>Spawnpoints, Encounters, the spawnpoint backup</td>
              </tr>
              <tr>
                <td>Golbat</td>
                <td>
                  <C>DELETE</C> on <C>spawnpoint</C>
                </td>
                <td>—</td>
                <td>Only the delete tool (optional)</td>
              </tr>
              <tr>
                <td>Each Dragonite</td>
                <td>
                  <C>SELECT</C>
                </td>
                <td>
                  <C>account</C> (the connection check)
                </td>
                <td>The connection check, the accounts list for a move</td>
              </tr>
              <tr>
                <td>Each Dragonite</td>
                <td>
                  <C>INSERT</C>, <C>DELETE</C> on <C>account</C>
                </td>
                <td>—</td>
                <td>Only moving accounts between stacks (optional)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          To check the account from Nacli's host: <C>{`mariadb -h 10.0.0.40 -u ${g.user} -p -e "SHOW GRANTS"`}</C>.
        </p>
      </Step>

      <Step n={7} id="map" title="The map">
        <p>
          The basemap of every map. The browser loads the tiles itself, so the URLs and key must be public. Without it, maps draw on a plain
          background.
        </p>
        <Code>{`[map]
style_url = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
style_url_dark = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
tiles_attribution = "&copy; OpenStreetMap &copy; CARTO"`}</Code>
      </Step>

      <Step n={8} id="check" title="Check it works">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Sidebar pills</b>: next to Rotom, Dragonite and Golbat, green when they answer. The <b>DB</b> pills (Dragonite and Golbat) turn red
            with the reason when the database can't be read; hover them to see it.
          </li>
          <li>
            <b>Status</b> shows each Dragonite and RotomNG, their versions, and whether each Dragonite's controllers reach its own stack's Rotom.
          </li>
          <li>
            <b>Connected here</b>, at the top of this page, lists what <C>config.toml</C> sets now.
          </li>
          <li>
            A page that is missing from the sidebar needs the part named above it; a red message on a page says which.
          </li>
        </ul>
      </Step>
    </div>
  );
}
