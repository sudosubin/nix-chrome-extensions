{ buildGoModule, fetchFromGitHub, lib }:

buildGoModule rec {
  pname = "go-crx3";
  version = "1.4.1";

  src = fetchFromGitHub {
    owner = "mmadfox";
    repo = "go-crx3";
    rev = "v${version}";
    sha256 = "sha256-qJdVpEed6CNvWOMj7Pao+f8sAkrNS47CQVtBGYxwDDA=";
  };

  vendorHash = "sha256-LEIB/VZA3rqTeH9SesZ/jrfVddl6xtmoRWHP+RwGmCk=";

  meta = with lib; {
    description = "Chrome browser extension tools";
    homepage = "https://github.com/mmadfox/go-crx3";
    license = licenses.asl20;
    mainProgram = "crx3";
    maintainers = with maintainers; [ sudosubin ];
  };
}
