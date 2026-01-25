{
  fetchurl,
  go-crx3,
  stdenvNoCC,
}:

{
  id,
  pname,
  url,
  hash,
  ...
}@args:

stdenvNoCC.mkDerivation (
  (removeAttrs args [
    "pname"
    "hash"
    "url"
  ])
  // {
    pname = "chrome-extension-${pname}";

    src = fetchurl {
      inherit url hash;
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
