import { z } from "zod";

export const AgentModelSchema = z.union([
  z.string(),
  z
    .object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
      rotation: z
        .object({
          strategy: z.literal("round-robin").optional(),
          stateFile: z.string().min(1).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
