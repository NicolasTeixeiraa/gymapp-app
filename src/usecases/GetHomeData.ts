import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { NotFoundError } from "../errors/index.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

dayjs.extend(utc);

const DAYJS_DAY_TO_WEEKDAY: Record<number, WeekDay> = {
  0: WeekDay.SUNDAY,
  1: WeekDay.MONDAY,
  2: WeekDay.TUESDAY,
  3: WeekDay.WEDNESDAY,
  4: WeekDay.THURSDAY,
  5: WeekDay.FRIDAY,
  6: WeekDay.SATURDAY,
};

interface InputDto {
  userId: string;
  date: string;
}

interface OutputDto {
  activeWorkoutPlanId: string;
  todayWorkoutDay?: {
    workoutPlanId: string;
    id: string;
    name: string;
    isRest: boolean;
    weekDay: WeekDay;
    estimatedDurationInSeconds: number;
    coverImageUrl?: string;
    exercisesCount: number;
  };
  workoutStreak: number;
  consistencyByDay: {
    [key: string]: {
      workoutDayCompleted: boolean;
      workoutDayStarted: boolean;
    };
  };
}

export class GetHomeData {
  async execute(dto: InputDto): Promise<OutputDto> {
    const date = dayjs.utc(dto.date);
    const weekStart = date.startOf("week");
    const weekEnd = date.endOf("week");

    const activePlan = await prisma.workoutPlan.findFirst({
      where: { userId: dto.userId, isActive: true },
      include: {
        workoutDays: {
          include: {
            exercises: { select: { id: true } },
            sessions: {
              where: {
                startedAt: {
                  gte: weekStart.toDate(),
                  lte: weekEnd.toDate(),
                },
              },
            },
          },
        },
      },
    });

    if (!activePlan) {
      throw new NotFoundError("No active workout plan found");
    }

    const todayWeekDay = DAYJS_DAY_TO_WEEKDAY[date.day()];
    const todayWorkoutDay = activePlan.workoutDays.find(
      (d) => d.weekDay === todayWeekDay,
    );

    const consistencyByDay: OutputDto["consistencyByDay"] = {};

    for (let i = 0; i < 7; i++) {
      const day = weekStart.add(i, "day");
      const dayKey = day.format("YYYY-MM-DD");
      const dayWeekDay = DAYJS_DAY_TO_WEEKDAY[day.day()];

      const sessionsOnDay = activePlan.workoutDays
        .filter((d) => d.weekDay === dayWeekDay)
        .flatMap((d) => d.sessions)
        .filter((s) => dayjs.utc(s.startedAt).format("YYYY-MM-DD") === dayKey);

      consistencyByDay[dayKey] = {
        workoutDayStarted: sessionsOnDay.length > 0,
        workoutDayCompleted: sessionsOnDay.some((s) => s.completedAt !== null),
      };
    }

    const allCompletedSessions = await prisma.workoutSession.findMany({
      where: {
        workoutDay: { workoutPlanId: activePlan.id },
        completedAt: { not: null },
      },
      include: {
        workoutDay: { select: { weekDay: true } },
      },
    });

    const completedByDate = new Map<string, Set<WeekDay>>();

    for (const session of allCompletedSessions) {
      const sessionDate = dayjs.utc(session.startedAt).format("YYYY-MM-DD");
      if (!completedByDate.has(sessionDate)) {
        completedByDate.set(sessionDate, new Set());
      }
      completedByDate.get(sessionDate)!.add(session.workoutDay.weekDay);
    }

    const plannedWeekDays = new Set(
      activePlan.workoutDays.filter((d) => !d.isRest).map((d) => d.weekDay),
    );

    let streak = 0;
    let currentDate = date;

    for (let i = 0; i < 365; i++) {
      const weekday = DAYJS_DAY_TO_WEEKDAY[currentDate.day()];

      if (plannedWeekDays.has(weekday)) {
        const dateKey = currentDate.format("YYYY-MM-DD");
        const completedWeekdays = completedByDate.get(dateKey);

        if (completedWeekdays?.has(weekday)) {
          streak++;
        } else {
          break;
        }
      }

      currentDate = currentDate.subtract(1, "day");
    }

    return {
      activeWorkoutPlanId: activePlan.id,
      todayWorkoutDay: todayWorkoutDay
        ? {
            workoutPlanId: activePlan.id,
            id: todayWorkoutDay.id,
            name: todayWorkoutDay.name,
            isRest: todayWorkoutDay.isRest,
            weekDay: todayWorkoutDay.weekDay,
            estimatedDurationInSeconds:
              todayWorkoutDay.estimatedDurationInSeconds,
            coverImageUrl: todayWorkoutDay.coverImageUrl ?? undefined,
            exercisesCount: todayWorkoutDay.exercises.length,
          }
        : undefined,
      workoutStreak: streak,
      consistencyByDay,
    };
  }
}
