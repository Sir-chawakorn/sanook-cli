class SanookCli < Formula
  desc "Terminal AI coding agent — BYOK, MCP, gateway, skills, second brain"
  homepage "https://github.com/Sir-chawakorn/sanook-cli"
  url "https://registry.npmjs.org/sanook-cli/-/sanook-cli-0.5.7.tgz"
  sha256 "5e85a1b8eb75b0aebeb5bdc606a60b452dbd512076ca823fc1f746f7cc27d357"
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
