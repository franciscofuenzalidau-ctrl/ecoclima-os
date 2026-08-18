/**
 * El código del panel siempre estuvo escrito con clases de Tailwind (más de 2.200 usos),
 * pero la dependencia nunca se instaló, así que todas eran inertes y el panel se veía plano.
 * Esto las activa. El CSS propio de index.css complementa a Tailwind, no lo reemplaza.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: { extend: {} },
  plugins: []
};
