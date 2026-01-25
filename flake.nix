{
  description = "sudosubin/nix-chrome-extensions";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      forAllSystems =
        with nixpkgs.lib;
        f: genAttrs platforms.unix (system: f (import nixpkgs { inherit system; }));

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
        default =
          final: prev:
          let
            buildChromeExtension = prev.callPackage ./nix/build-chrome-extension.nix { };

            loadGenerated =
              { site }:
              let
                json = builtins.fromJSON (builtins.readFile ./data/${site}.json);
              in
              builtins.listToAttrs (
                map (v: {
                  name = v.pname;
                  value = buildChromeExtension {
                    inherit (v)
                      id
                      pname
                      version
                      url
                      hash
                      ;
                  };
                }) json
              );

          in
          {
            chrome-web-store = loadGenerated { site = "chrome-web-store"; };
          };
      };
    };
}
