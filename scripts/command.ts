import webstore from "chrome-webstore";
import { program } from "commander";
import pLimit from "p-limit";
import { exec } from "node:child_process";
import fs from "node:fs";
import { EOL } from "node:os";
import path from "node:path";

interface Extension {
  id: string;
  pname: string;
  version: string;
  sha256: string;
  published: string;
  lastUpdated: string;
}

interface Item {
  id: string;
  pname: string;
}

interface PrefetchOptions {
  url: string;
  name: string;
}

interface UpdateOptions {
  id: string;
  pname: string;
  site: string;
  prev?: Extension;
}

const limit = pLimit(10);
const prodversion = "125.0.6422.141";

const paths = {
  all: path.join(import.meta.dirname, "..", "data", "all.json"),
  chromeWebStore: path.join(
    import.meta.dirname,
    "..",
    "data",
    "chrome-web-store.json"
  ),
  data: path.join(import.meta.dirname, "..", "data"),
};

const chunk = <T>(input: T[], index: number, size: number): T[] => {
  const unit = Math.ceil(input.length / size);
  return input.slice(index * unit, (index + 1) * unit);
};

const groupBy = <T, K extends string>(
  input: T[],
  selector: (item: T) => K
): Record<K, T[]> => {
  const obj = {} as Record<K, T[]>;
  for (const value of input) {
    const key = selector(value);
    obj[key] = [...(obj[key] || []), value];
  }
  return obj;
};

const prefetch = async ({ url, name }: PrefetchOptions): Promise<string> => {
  const proc = exec(`nix-prefetch-url "${url}" --name "${name}"`);
  return (await new Response(proc.stdout).text()).trim();
};

const update = async ({
  id,
  pname,
  prev,
}: UpdateOptions): Promise<Extension> => {
  const url = `https://clients2.google.com/service/update2/crx?acceptformat=crx3&prodversion=${prodversion}&response=redirect&x=id%3D${id}%26uc`;
  const extension = await webstore.detail({ id });
  const published = new Date(`${(extension as any).published} UTC`)
    .toISOString()
    .slice(0, 10);

  const hasChange =
    !prev || prev.version !== extension.version || prev.published !== published;

  return {
    id,
    pname,
    version: extension.version,
    sha256: !hasChange ? prev.sha256 : await prefetch({ url, name: id }),
    published: published,
    lastUpdated: !hasChange ? prev.lastUpdated : new Date().toISOString(),
  };
};

const readJsonFile = async <T>(file: string): Promise<T> => {
  const data = await fs.promises.readFile(file, { encoding: "utf-8" });
  return JSON.parse(data);
};

const writeJsonFile = async (file: string, data: any) => {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  return await fs.promises.writeFile(
    file,
    JSON.stringify(data, undefined, 2) + EOL,
    { encoding: "utf-8" }
  );
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
      items.map(({ id, pname }) => ({ id, pname, site }))
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
        })
      )
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
      groupBy(data, groupSelector)
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
        ])
      )
    );

    console.log("[INFO] read ./data/shard/*.json");
    const files = await fs.promises.readdir(path.join(paths.data, "shard"));
    const result = await Promise.all(
      files.map((file) =>
        readJsonFile<Record<string, Extension[]>>(
          path.join(path.join(paths.data, "shard", file))
        )
      )
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
        extensions.toSorted((a, b) => a.id.localeCompare(b.id))
      );
    }

    console.log("[INFO] remove ./data/shard/*.json");
    await fs.promises.rm(path.join(paths.data, "shard"), {
      recursive: true,
      force: true,
    });
  });

await program.parseAsync();
