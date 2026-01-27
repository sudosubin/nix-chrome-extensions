import unzip from "@tomjs/unzip-crx";
import { program } from "commander";
import pLimit from "p-limit";
import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

interface Extension {
  id: string;
  pname: string;
  version: string;
  url: string;
  hash: string;
  lastUpdated: string;
}

interface Item {
  id: string;
  pname: string;
}

interface UpdateOptions {
  id: string;
  pname: string;
  site: string;
  prev?: Extension;
}

class ChromeWebStoreExtension {
  private prodversion = "144.0.7559.59";

  constructor(public id: string) {}

  public async getRedirectUrl(): Promise<string> {
    const redirectResponse = await fetch(this.url, { redirect: "manual" });
    if (redirectResponse.status === 204) {
      throw new Error(
        `Extension ${this.id} is not available (HTTP 204 - extension may be removed from Chrome Web Store)`,
      );
    }

    const redirectUrl = redirectResponse.headers.get("location");
    if (!redirectUrl) {
      throw new Error(
        `No redirect URL found for extension ${this.id} (HTTP ${redirectResponse.status})`,
      );
    }

    return redirectUrl;
  }

  public async fetch() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-extensions-"));
    const crx = path.join(root, "extension.crx");

    console.log(`[INFO] download and unzip ${this.id}`);

    const redirectUrl = await this.getRedirectUrl();
    const buffer = await fetch(redirectUrl).then((res) => res.arrayBuffer());
    await fs.writeFile(crx, Buffer.from(buffer));
    await unzip(crx, root);

    return {
      url: redirectUrl,
      hash: await this.sha256(crx),
      version: await this.version(path.join(root, "manifest.json")),
      [Symbol.asyncDispose]: () => fs.rm(root, { recursive: true }),
    };
  }

  private async sha256(crx: string) {
    const proc = exec(`nix hash file --type sha256 --sri "${crx}"`);
    return (await new Response(proc.stdout).text()).trim();
  }

  private async version(path: string) {
    const manifest = await fs.readFile(path, { encoding: "utf-8" });
    return JSON.parse(manifest).version;
  }

  private get url() {
    return `https://clients2.google.com/service/update2/crx?acceptformat=crx3&prodversion=${this.prodversion}&response=redirect&x=id%3D${this.id}%26uc`;
  }
}

const limit = pLimit(10);

const paths = {
  all: path.join(import.meta.dirname, "..", "data", "all.json"),
  chromeWebStore: path.join(
    import.meta.dirname,
    "..",
    "data",
    "chrome-web-store.json",
  ),
  data: path.join(import.meta.dirname, "..", "data"),
};

const chunk = <T>(input: T[], index: number, size: number): T[] => {
  const unit = Math.ceil(input.length / size);
  return input.slice(index * unit, (index + 1) * unit);
};

const groupBy = <T, K extends string>(
  input: T[],
  selector: (item: T) => K,
): Record<K, T[]> => {
  const obj = {} as Record<K, T[]>;
  for (const value of input) {
    const key = selector(value);
    obj[key] = [...(obj[key] || []), value];
  }
  return obj;
};

const update = async ({
  id,
  pname,
  prev,
}: UpdateOptions): Promise<Extension> => {
  const extension = new ChromeWebStoreExtension(id);
  const redirectUrl = await extension.getRedirectUrl();

  if (prev && prev.url === redirectUrl) {
    console.log(`[INFO] skip ${id}: url unchanged`);
    return prev;
  }

  await using cur = await extension.fetch();

  const hasChange = prev?.hash !== cur.hash || prev?.version !== cur.version;

  return {
    id,
    pname,
    version: cur.version,
    url: cur.url,
    hash: cur.hash,
    lastUpdated: !hasChange ? prev.lastUpdated : new Date().toISOString(),
  };
};

const readJsonFile = async <T>(file: string): Promise<T> => {
  const data = await fs.readFile(file, { encoding: "utf-8" });
  return JSON.parse(data);
};

const writeJsonFile = async (file: string, data: any) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  return await fs.writeFile(file, JSON.stringify(data, undefined, 2) + os.EOL, {
    encoding: "utf-8",
  });
};

program
  .command("update [shard]")
  .description("update chrome extensions")
  .action(async (shard: string = "1/1") => {
    const all = await readJsonFile<Record<string, Item[]>>(paths.all);
    const sites = {
      "chrome-web-store": await readJsonFile<Extension[]>(paths.chromeWebStore),
    } as Record<string, Extension[]>;

    const extensions = Object.entries(all).flatMap(([site, items]) =>
      items.map(({ id, pname }) => ({ id, pname, site })),
    );

    console.log(`[INFO] update shard: ${shard}`);
    const [index, size] = shard.split("/").map((v) => Number.parseInt(v));
    if (index === undefined || size === undefined) {
      throw new Error(`invalid shard: ${shard}`);
    }

    const sharded = chunk(extensions, index - 1, size);
    console.log(`[INFO] load sharded extensions: ${sharded.length}`);

    const data = await Promise.all(
      sharded.map(({ id, pname, site }) =>
        limit(() => {
          const prev = sites[site]?.find((extension) => extension.id === id);
          return update({ id, pname, site, prev });
        }),
      ),
    );

    const groupSelector = (item: Extension): string => {
      const extension = extensions.find(({ id }) => id === item.id);
      if (extension === undefined) {
        throw new Error(`invalid extension without site: ${item.id}`);
      }
      return extension.site;
    };

    await writeJsonFile(
      path.join(paths.data, "shard", `${index}.json`),
      groupBy(data, groupSelector),
    );
  });

program
  .command("combine")
  .description("combine sharded files into one")
  .action(async () => {
    console.log("[INFO] format ./data/all.json");
    const all = await readJsonFile<Record<string, Item[]>>(paths.all);
    await writeJsonFile(
      paths.all,
      Object.fromEntries(
        Object.entries(all).map(([site, extensions]) => [
          site,
          extensions.toSorted((a, b) => a.id.localeCompare(b.id)),
        ]),
      ),
    );

    console.log("[INFO] read ./data/shard/*.json");
    const files = await fs.readdir(path.join(paths.data, "shard"));
    const result = await Promise.all(
      files.map((file) =>
        readJsonFile<Record<string, Extension[]>>(
          path.join(path.join(paths.data, "shard", file)),
        ),
      ),
    );

    console.log("[INFO] combine ./data/shard/*.json");
    const data = result.reduce<Record<string, Extension[]>>((prev, item) => {
      const obj = {} as Record<string, Extension[]>;
      for (const [site, extensions] of Object.entries(prev)) {
        obj[site] = [...(obj[site] || []), ...extensions];
      }
      for (const [site, extensions] of Object.entries(item)) {
        obj[site] = [...(obj[site] || []), ...extensions];
      }
      return obj;
    }, {});

    console.log("[INFO] write ./data/*.json");
    for (const [site, extensions] of Object.entries(data)) {
      await writeJsonFile(
        path.join(paths.data, `${site}.json`),
        extensions.toSorted((a, b) => a.id.localeCompare(b.id)),
      );
    }

    console.log("[INFO] remove ./data/shard/*.json");
    await fs.rm(path.join(paths.data, "shard"), {
      recursive: true,
      force: true,
    });
  });

await program.parseAsync();
