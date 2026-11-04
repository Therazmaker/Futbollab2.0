// Build de Vercel.
// Con CONVEX_DEPLOY_KEY: sube primero las funciones de convex/ y luego compila
// Next con NEXT_PUBLIC_CONVEX_URL apuntando AL MISMO deployment que se acaba de
// subir (así la web y el backend nunca quedan desincronizados).
// Sin la clave: solo compila la web.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (process.env.CONVEX_DEPLOY_KEY) {
  console.log("[build] CONVEX_DEPLOY_KEY encontrada: desplegando Convex + Next");
  run('npx convex deploy --cmd "npx next build" --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL');
} else {
  console.warn("[build] Sin CONVEX_DEPLOY_KEY: solo se compila Next (el backend Convex NO se actualiza)");
  run("npx next build");
}
