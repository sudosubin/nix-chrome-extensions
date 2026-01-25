(import (fetchTarball {
  url = "https://github.com/edolstra/flake-compat/archive/v1.1.0.tar.gz";
  sha256 = "sha256-NeCCThCEP3eCl2l/+27kNNK7QrwZB1IJCrXfrbv5oqU=";
}) { src = ./.; }).defaultNix
