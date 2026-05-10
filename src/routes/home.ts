import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { NotFoundError } from "../errors/index.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { ErrorSchema } from "../schemas/index.js";
import { GetHomeData } from "../usecases/GetHomeData.js";

export const homeRoutes = async (app: FastifyInstance) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/:date",
    schema: {
      tags: ["Home"],
      summary: "Get home page data for a given date",
      params: z.object({
        date: z.iso.date(),
      }),
      response: {
        200: z.object({
          activeWorkoutPlanId: z.string().uuid(),
          todayWorkoutDay: z.object({
            workoutPlanId: z.string().uuid(),
            id: z.string().uuid(),
            name: z.string(),
            isRest: z.boolean(),
            weekDay: z.enum(WeekDay),
            estimatedDurationInSeconds: z.number(),
            coverImageUrl: z.url().optional(),
            exercisesCount: z.number(),
          }),
          workoutStreak: z.number(),
          consistencyByDay: z.record(
            z.string(),
            z.object({
              workoutDayCompleted: z.boolean(),
              workoutDayStarted: z.boolean(),
            }),
          ),
        }),
        401: ErrorSchema,
        404: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }
        const getHomeData = new GetHomeData();
        const result = await getHomeData.execute({
          userId: session.user.id,
          date: request.params.date,
        });
        return reply.status(200).send(result);
      } catch (error) {
        app.log.error(error);
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND_ERROR",
          });
        }
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });
};
