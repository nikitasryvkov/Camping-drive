import { provisionRuntimeDatabaseRole } from "./provision-runtime-role.js";

await provisionRuntimeDatabaseRole();
console.log("Runtime database role is provisioned");
