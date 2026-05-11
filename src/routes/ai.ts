import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { ErrorSchema } from "../schemas/index.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";
import { GetUserTrainData } from "../usecases/GetUserTrainData.js";
import { GetWorkoutPlans } from "../usecases/GetWorkoutPlans.js";
import { UpsertUserTrainData } from "../usecases/UpsertUserTrainData.js";

const SYSTEM_PROMPT = `
Você é um personal trainer virtual especializado em montagem de planos de treino.
Seu tom é amigável, motivador, com linguagem simples e sem jargões técnicos. Seu principal público são pessoas leigas em musculação.

## Ao iniciar qualquer conversa
SEMPRE chame a tool \`getUserTrainData\` antes de qualquer outra ação.
- Se retornar null: pergunte nome, peso (em kg), altura (em cm), idade e % de gordura corporal em uma única mensagem simples e direta. Após receber as respostas, salve com \`updateUserTrainData\` (convertendo o peso de kg para gramas, ou seja, multiplique por 1000).
- Se já tiver dados: cumprimente o usuário pelo nome.

## Para criar um plano de treino
Pergunte em uma única mensagem:
1. Objetivo (ganho de massa, emagrecimento ou força)
2. Quantos dias por semana tem disponíveis (2 a 6)
3. Alguma restrição física ou lesão

O plano DEVE conter exatamente 7 dias (MONDAY a SUNDAY). Dias sem treino devem ter: isRest: true, exercises: [], estimatedDurationInSeconds: 0.
Após definir o plano, chame \`createWorkoutPlan\` para criá-lo.

## Divisão de treinos (Splits)
Escolha a divisão com base nos dias disponíveis:
- 2-3 dias/semana: Full Body ou ABC (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas+Ombros)
- 4 dias/semana: Upper/Lower — recomendado, cada grupo 2x/semana — ou ABCD (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas, D: Ombros+Abdômen)
- 5 dias/semana: PPLUL — Push/Pull/Legs + Upper/Lower (superior 3x, inferior 2x/semana)
- 6 dias/semana: PPL 2x — Push/Pull/Legs repetido

## Princípios de montagem
- Músculos sinérgicos juntos (peito+tríceps, costas+bíceps)
- Exercícios compostos primeiro, isoladores depois
- 4 a 8 exercícios por sessão
- 3-4 séries por exercício; 8-12 reps (hipertrofia) ou 4-6 reps (força)
- Descanso entre séries: 60-90s (hipertrofia), 2-3min (compostos pesados)
- Nunca treinar o mesmo grupo muscular em dias consecutivos
- Nomes descritivos para cada dia (ex: "Superior A - Peito e Tríceps", "Descanso")

## Imagens de capa (coverImageUrl)
SEMPRE fornecer uma coverImageUrl para cada dia de treino.

Dias majoritariamente superiores (peito, costas, ombros, bíceps, tríceps, push, pull, upper, full body) e dias de descanso:
- Opção 1: https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO3y8pQ6GBg8iqe9pP2JrHjwd1nfKtVSQskI0v
- Opção 2: https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOW3fJmqZe4yoUcwvRPQa8kmFprzNiC30hqftL

Dias majoritariamente inferiores (pernas, glúteos, quadríceps, posterior, panturrilha, legs, lower):
- Opção 1: https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOgCHaUgNGronCvXmSzAMs1N3KgLdE5yHT6Ykj
- Opção 2: https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO85RVu3morROwZk5NPhs1jzH7X8TyEvLUCGxY

Alterne entre as duas opções de cada categoria para variar.

## Estilo de resposta
Respostas curtas e objetivas.
`.trim();

export const aiRoutes = async (app: FastifyInstance) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/",
    schema: {
      tags: ["AI"],
      summary: "Chat with the virtual personal trainer",
      body: z.object({
        messages: z.array(z.custom<UIMessage>()),
      }),
      response: {
        200: z.unknown(),
        401: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session) {
        return reply.status(401).send({
          error: "Unauthorized",
          code: "UNAUTHORIZED",
        });
      }

      const userId = session.user.id;
      const { messages } = request.body;

      const modelMessages = await convertToModelMessages(messages);
      const result = streamText({
        model: openai("gpt-4o-mini"),
        system: SYSTEM_PROMPT,
        tools: {
          getUserTrainData: tool({
            description:
              "Retorna os dados de treino do usuário (peso, altura, idade, % de gordura). Chame SEMPRE antes de qualquer interação.",
            inputSchema: z.object({}),
            execute: async () => {
              const getUserTrainData = new GetUserTrainData();
              return getUserTrainData.execute({ userId });
            },
          }),
          updateUserTrainData: tool({
            description: "Cria ou atualiza os dados de treino do usuário.",
            inputSchema: z.object({
              weightInGrams: z.number().describe("Peso em gramas."),
              heightInCentimeters: z
                .number()
                .describe("Altura em centímetros."),
              age: z.number().describe("Idade em anos."),
              bodyFatPercentage: z
                .number()
                .int()
                .min(0)
                .max(100)
                .describe(
                  "Percentual de gordura corporal como inteiro de 0 a 100 (ex: 15 para 15%).",
                ),
            }),
            execute: async (input) => {
              const upsertUserTrainData = new UpsertUserTrainData();
              return upsertUserTrainData.execute({ userId, ...input });
            },
          }),
          getWorkoutPlans: tool({
            description: "Lista todos os planos de treino do usuário.",
            inputSchema: z.object({}),
            execute: async () => {
              const getWorkoutPlans = new GetWorkoutPlans();
              return getWorkoutPlans.execute({ userId });
            },
          }),
          createWorkoutPlan: tool({
            description:
              "Cria um novo plano de treino completo com exatamente 7 dias (MONDAY a SUNDAY).",
            inputSchema: z.object({
              name: z.string().describe("Nome do plano de treino."),
              workoutDays: z
                .array(
                  z.object({
                    name: z
                      .string()
                      .describe(
                        "Nome descritivo do dia (ex: 'Superior A - Peito e Tríceps', 'Descanso').",
                      ),
                    weekDay: z.enum(WeekDay).describe("Dia da semana."),
                    isRest: z
                      .boolean()
                      .describe(
                        "true para dia de descanso, false para dia de treino.",
                      ),
                    estimatedDurationInSeconds: z
                      .number()
                      .describe(
                        "Duração estimada em segundos (0 para dias de descanso).",
                      ),
                    coverImageUrl: z
                      .string()
                      .url()
                      .describe("URL da imagem de capa do dia."),
                    exercises: z
                      .array(
                        z.object({
                          order: z
                            .number()
                            .describe("Ordem do exercício na sessão."),
                          name: z.string().describe("Nome do exercício."),
                          sets: z.number().describe("Número de séries."),
                          reps: z.number().describe("Número de repetições."),
                          restTimeInSeconds: z
                            .number()
                            .describe(
                              "Tempo de descanso entre séries em segundos.",
                            ),
                        }),
                      )
                      .describe(
                        "Lista de exercícios. Vazia para dias de descanso.",
                      ),
                  }),
                )
                .describe("Array com exatamente 7 dias (MONDAY a SUNDAY)."),
            }),
            execute: async (input) => {
              const createWorkoutPlan = new CreateWorkoutPlan();
              return createWorkoutPlan.execute({ userId, ...input });
            },
          }),
        },
        stopWhen: stepCountIs(5),
        messages: modelMessages,
      });

      const response = result.toUIMessageStreamResponse();
      reply.status(200);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body as unknown);
    },
  });
};
