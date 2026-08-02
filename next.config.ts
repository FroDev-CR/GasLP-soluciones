import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * pdfkit lee sus fuentes (.afm) desde disco usando __dirname. Al empaquetarlo,
   * el bundler reescribe esa ruta a "/ROOT/node_modules/pdfkit/..." y en Vercel
   * falla con ENOENT. Se carga desde node_modules en tiempo de ejecución.
   */
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
