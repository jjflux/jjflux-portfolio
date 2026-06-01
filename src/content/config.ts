// ---------------------------------------------------------------
// CONTENT COLLECTIONS — the schema for projects.
// Each .mdx file in src/content/projects/ MUST include this
// frontmatter. Type-checked at build time so typos can't break the
// site silently.
// ---------------------------------------------------------------

import { defineCollection, z } from "astro:content";

const projects = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    summary: z.string().describe("One-sentence elevator pitch."),
    status: z.enum(["live", "in-progress", "archived", "concept"]).default("live"),
    year: z.number().int().min(2000).max(2100),
    role: z.string().optional().describe("e.g. 'Builder', 'Solo', 'Designer & dev'"),
    tech: z.array(z.string()).default([]).describe("Tech stack as short tags."),
    coverImage: z.string().optional().describe("Path under /public, e.g. /projects/my-app/cover.png"),
    links: z
      .object({
        // Accept a full URL (https://…) OR a root-relative path (e.g. /physarum/)
        // so locally-hosted apps in /public can be linked as the live demo.
        live: z
          .string()
          .refine((s) => /^https?:\/\//.test(s) || s.startsWith("/"), {
            message: "live must be a full URL or a root-relative path starting with /",
          })
          .optional(),
        appStore: z.string().url().optional(),
        playStore: z.string().url().optional(),
        github: z.string().url().optional(),
        demo: z.string().url().optional(),
      })
      .partial()
      .optional(),
    featured: z.boolean().default(false),
    order: z.number().default(100).describe("Lower = shown first on the homepage."),
    draft: z.boolean().default(false),
  }),
});

export const collections = { projects };
