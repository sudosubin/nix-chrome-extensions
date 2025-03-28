{
  description = "sudosubin/nix-chrome-extensions";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-compat.url = "github:edolstra/flake-compat";
    flake-compat.flake = false;
  };

  outputs = { self, nixpkgs, ... }:
    let
      forAllSystems = with nixpkgs.lib; f: genAttrs platforms.unix (system: f (import nixpkgs { inherit system; }));

    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            go-crx3
            nodejs-slim
            nodePackages.pnpm
          ];
        };
      });
      extensions = forAllSystems (pkgs: self.overlays.default pkgs pkgs);
      overlays = {
        default = final: prev:
          let
            buildChromeExtension = prev.callPackage ./nix/build-chrome-extension.nix { };

            loadGenerated = { site, prodversion ? prev.chromium.version }:
              let
                json = builtins.fromJSON (builtins.readFile ./data/${site}.json);
                extensions = map
                  ({ id, ... }@extension: extension // {
                    url = "https://clients2.google.com/service/update2/crx?acceptformat=crx3&prodversion=${prodversion}&response=redirect&x=id%3D${id}%26uc";
                  })
                  json;
              in
              builtins.listToAttrs (map
                (v: {
                  name = v.pname;
                  value = buildChromeExtension {
                    inherit (v) id pname version url sha256;
                  };
                })
                extensions);

          in
          {
            chrome-web-store = loadGenerated { site = "chrome-web-store"; };
          };
      };
    };
}
