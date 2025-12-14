import { defineConfig, env } from "prisma/config";
import "dotenv/config";

export default defineConfig({
    schema: "prisma/schema.prisma",
    datasource: {
        // Reads the SQLite path from .env file
        // Path is relative to schema.prisma, so ../risk-assessments.db points to project root
        url: env("DATABASE_URL"),
    },
});
