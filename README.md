# nix-chrome-extensions

Nix expressions for Chrome extensions from the [Chrome Web Store](https://chromewebstore.google.com). A [GitHub Action](https://github.com/sudosubin/nix-chrome-extensions/actions/workflows/update-extensions.yml) updates the extensions every hour.

Each extension is fetched as a CRX package, unpacked, and made available as a Nix derivation through a nixpkgs overlay.

## Prerequisites

### (Optional) Enable flakes

Read about [Nix flakes](https://wiki.nixos.org/wiki/Flakes) and [set them up](https://wiki.nixos.org/wiki/Flakes#Setup).

## Overlay

Read about [Overlays](https://wiki.nixos.org/wiki/Overlays#Using_overlays).

### With flakes

Add `nix-chrome-extensions` to your flake inputs:

```nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    nix-chrome-extensions.url = "github:sudosubin/nix-chrome-extensions";
  };

  outputs = { nixpkgs, nix-chrome-extensions, ... }:
    let
      pkgs = import nixpkgs {
        system = "aarch64-darwin"; # or "x86_64-linux", etc.
        overlays = [ nix-chrome-extensions.overlays.default ];
      };
    in
    {
      # pkgs.chrome-web-store.<pname>
    };
}
```

### Without flakes

```nix
let
  nix-chrome-extensions = import (builtins.fetchGit {
    url = "https://github.com/sudosubin/nix-chrome-extensions";
    ref = "refs/heads/main";
  });

  pkgs = import <nixpkgs> {
    overlays = [ nix-chrome-extensions.overlays.default ];
  };
in
  # pkgs.chrome-web-store.<pname>
```

## Usage

### Get `extensions`

#### Get `extensions` via the overlay

After applying the overlay (see [Overlay](#overlay)), extensions are available under `pkgs.chrome-web-store`:

```nix
pkgs.chrome-web-store.<pname>
```

#### Get `extensions` from `nix-chrome-extensions` directly

Without the overlay, you can access extensions from the flake outputs:

```nix
nix-chrome-extensions.extensions.${system}.chrome-web-store.<pname>
```

### Extension identifiers

Extensions are identified by their `pname` under `chrome-web-store`:

```nix
pkgs.chrome-web-store.ublock-origin-lite
```

### Example: load unpacked extensions into Chromium (home-manager)

Extension derivations live in the read-only Nix store, but Chromium expects
writable extension directories. The workaround is to **rsync** derivation
outputs to a mutable path, then **wrap** the browser binary with
`--load-extension` pointing there.

```nix
# home-manager configuration
{ config, lib, pkgs, ... }:

let
  extensions = with pkgs.chrome-web-store; [
    ublock-origin-lite
  ];

  extensionsDir = "${config.home.homeDirectory}/.local/share/chromium-extensions";
in
{
  programs.chromium = {
    enable = true;
    package = pkgs.ungoogled-chromium.override {
      commandLineArgs = toString [
        "--load-extension=${lib.concatMapStringsSep "," (ext: "${extensionsDir}/${ext.id}") extensions}"
      ];
    };
  };

  home.activation.chromiumExtensions = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "${extensionsDir}"
    ${lib.concatMapStrings (ext: ''
      run ${lib.getExe pkgs.rsync} -a --delete --chmod=+w \
        "${ext}/" "${extensionsDir}/${ext.id}/"
    '') extensions}
  '';
}
```

## Explore

### List available extensions in REPL

```console
$ nix repl

nix-repl> :lf github:sudosubin/nix-chrome-extensions

nix-repl> extensions = outputs.extensions.${builtins.currentSystem}

nix-repl> builtins.attrNames extensions.chrome-web-store
[ "_1password" "claude" "deepl" "google-translate" "neutral-face-emoji-tools" "react-developer-tools" "trancy" "ublock-origin-lite" ]

nix-repl> extensions.chrome-web-store.ublock-origin-lite
«derivation /nix/store/...-chrome-extension-ublock-origin-lite-2026.308.1810.drv»
```

### Build an extension

```console
nix build github:sudosubin/nix-chrome-extensions#extensions.aarch64-darwin.chrome-web-store.ublock-origin-lite
```

## How it works

1. A GitHub Actions workflow runs every hour.
2. For each extension listed in `data/all.json`, it fetches the latest CRX package from the Chrome Web Store.
3. The CRX is hashed with `nix hash file` and unpacked to read the version from `manifest.json`.
4. The results are stored in `data/chrome-web-store.json`.
5. At evaluation time, Nix fetches each CRX by URL, unpacks it with `crx3`, and outputs the extension directory.

## License

[MIT](LICENSE)
