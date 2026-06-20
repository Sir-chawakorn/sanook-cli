# Homebrew formula for Sanook CLI.
#
# This installs the CLI from the npm registry into Homebrew's prefix.
# Host it in a tap repo (e.g. github.com/Sir-chawakorn/homebrew-tap) so users can:
#   brew tap Sir-chawakorn/tap
#   brew install sanook-cli
#
# After publishing a new npm version, update `url` + `sha256`:
#   curl -sL https://registry.npmjs.org/sanook-cli/-/sanook-cli-<VERSION>.tgz -o pkg.tgz
#   shasum -a 256 pkg.tgz
class SanookCli < Formula
  desc "Terminal AI coding agent — BYOK, MCP, gateway, skills, second brain"
  homepage "https://github.com/Sir-chawakorn/sanook-cli"
  url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-0.5.7.tgz"
  sha256 "REPLACE_WITH_SHA256_OF_THE_TARBALL"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "sanook", shell_output("#{bin}/sanook --help")
  end
end
