import next from "eslint-config-next";

const config = [...next, { ignores: [".next/**", "drizzle/**"] }];
export default config;
