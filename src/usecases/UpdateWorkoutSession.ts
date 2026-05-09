import { ForbiddenError, NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  workoutPlanId: string;
  workoutDayId: string;
  sessionId: string;
  completedAt: string;
}

interface OutputDto {
  id: string;
  completedAt: string;
  startedAt: string;
}

export class UpdateWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutPlan = await prisma.workoutPlan.findUnique({
      where: { id: dto.workoutPlanId },
    });

    if (!workoutPlan) {
      throw new NotFoundError("Workout plan not found");
    }

    if (workoutPlan.userId !== dto.userId) {
      throw new ForbiddenError("You are not the owner of this workout plan");
    }

    const workoutDay = await prisma.workoutDay.findFirst({
      where: { id: dto.workoutDayId, workoutPlanId: dto.workoutPlanId },
    });

    if (!workoutDay) {
      throw new NotFoundError("Workout day not found");
    }

    const workoutSession = await prisma.workoutSession.findFirst({
      where: { id: dto.sessionId, workoutDayId: dto.workoutDayId },
    });

    if (!workoutSession) {
      throw new NotFoundError("Workout session not found");
    }

    const updated = await prisma.workoutSession.update({
      where: { id: dto.sessionId },
      data: { completedAt: new Date(dto.completedAt) },
    });

    return {
      id: updated.id,
      completedAt: updated.completedAt!.toISOString(),
      startedAt: updated.startedAt.toISOString(),
    };
  }
}
