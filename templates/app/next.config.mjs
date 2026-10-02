/** ShipProbe runs on the server and reads Node APIs, so Next leaves it unbundled. */
const nextConfig = {
  serverExternalPackages: ['shipprobe'],
  poweredByHeader: false,
};

export default nextConfig;
