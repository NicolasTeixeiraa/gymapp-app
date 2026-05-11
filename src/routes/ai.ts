import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  UIMessage,
} from "ai";
import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import z from "zod";

import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";

export const aiRoutes = async (app: FastifyInstance) => {
  app.post("/ai", async (request, reply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) {
      return reply.status(401).send({
        error: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    }
    const { messages } = request.body as { messages: UIMessage[] };
    const result = streamText({
      model: openai("gpt-4o-mini"),
      system: "",
      tools: {
        getUserTrainData: tool({}),
        updateUserTrainData: tool({}),
        getWorkoutPlan: tool({}),
        createWorkoutPlan: tool({
          description: "Cria um novo plano de treino completo.",
          inputSchema: z.object({
            name: z.string().describe("O nome do plano de treino."),
            workoutDays: z
              .array(
                z.object({
                  name: z
                    .string()
                    .describe(
                      "O nome do dia de treino (ex: 'Treino de Peito', 'Treino de Costas', descanso, etc.)",
                    ),
                  weekDay: z
                    .enum(WeekDay)
                    .describe("O dia da semana do treino."),
                  isRest: z
                    .boolean()
                    .describe(
                      "Se o dia é um dia de descanso (true) ou um dia de treino (false).",
                    ),
                  estimatedDurationInSeconds: z
                    .number()
                    .describe(
                      "A duração estimada do dia de treino em segundos (0 para dias de descanso).",
                    ),
                  coverImageUrl: z
                    .string()
                    .url()
                    .describe(
                      "A URL da imagem do dia de treino. Usar as URLs de superior ou inferior conforme o foco muscular do dia.",
                    ),
                  exercises: z
                    .array(
                      z.object({
                        order: z
                          .number()
                          .describe("Ordem do exercício no dia de treino."),
                        name: z.string().describe("Nome do exercício."),
                        sets: z
                          .number()
                          .describe("Número de séries do exercício."),
                        reps: z
                          .number()
                          .describe("Número de repetições do exercício."),
                        restTimeInSeconds: z
                          .number()
                          .describe(
                            "Tempo de descanso entre as séries em segundos.",
                          ),
                      }),
                    )
                    .describe(
                      "Lista de exercícios. (vazia para dias de descanso)",
                    ),
                }),
              )
              .describe(
                "Array com exatamente 7 dias de treino (MONDAY a SUNDAY).",
              ),
          }),
          execute: async (input) => {
            const createWorkoutPlan = new CreateWorkoutPlan();
            const result = await createWorkoutPlan.execute({
              userId: session.user.id,
              name: input.name,
              workoutDays: input.workoutDays,
            });
            return result;
          },
        }),
      },
      stopWhen: stepCountIs(5),
      messages: await convertToModelMessages(messages),
    });
    const response = result.toUIMessageStreamResponse();
    reply.status(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));
    return reply.send(response.body);
  });
};
