{ fetchurl, go-crx3, stdenvNoCC }:

{ id, pname, sha256, url, ... }@args:

stdenvNoCC.mkDerivation (
  (removeAttrs args [ "id" "pname" "sha256" "url" ]) // {
    pname = "chrome-extension-${pname}";

    src = fetchurl {
      inherit sha256 url;
    };

    nativeBuildInputs = [ go-crx3 ];

    unpackPhase = ''
      runHook preUnpack
      cp $src ./out.crx
      crx3 unpack ./out.crx
      runHook postUnpack
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -R ./out/* "$out"
      runHook postInstall
    '';
  }
)
