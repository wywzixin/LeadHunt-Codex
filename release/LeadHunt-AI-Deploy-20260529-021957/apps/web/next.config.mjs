const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@leadhunt/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:4000"}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
