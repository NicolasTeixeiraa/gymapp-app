import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

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
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

interface OutputDto {
  workoutStreak: number;
  consistencyByDay: {
    [key: string]: {
      workoutDayCompleted: boolean;
      workoutDayStarted: boolean;
    };
  };
  completedWorkoutsCount: number;
  conclusionRate: number;
  totalTimeInSeconds: number;
}

export class GetStats {
  async execute(dto: InputDto): Promise<OutputDto> {
    const from = new Date(`${dto.from}T00:00:00.000Z`);
    const to = new Date(`${dto.to}T23:59:59.999Z`);

    const sessions = await prisma.workoutSession.findMany({
      where: {
        workoutDay: {
          workoutPlan: { userId: dto.userId },
        },
        startedAt: { gte: from, lte: to },
      },
    });

    const consistencyByDay: OutputDto["consistencyByDay"] = {};

    for (const session of sessions) {
      const dateKey = dayjs.utc(session.startedAt).format("YYYY-MM-DD");

      if (!consistencyByDay[dateKey]) {
        consistencyByDay[dateKey] = {
          workoutDayStarted: true,
          workoutDayCompleted: false,
        };
      }

      if (session.completedAt !== null) {
        consistencyByDay[dateKey].workoutDayCompleted = true;
      }
    }

    const completedSessions = sessions.filter((s) => s.completedAt !== null);
    const completedWorkoutsCount = completedSessions.length;
    const conclusionRate =
      sessions.length > 0 ? completedWorkoutsCount / sessions.length : 0;

    const totalTimeInSeconds = completedSessions.reduce((acc, session) => {
      return acc + dayjs.utc(session.completedAt!).diff(dayjs.utc(session.startedAt), "second");
    }, 0);

    const activePlan = await prisma.workoutPlan.findFirst({
      where: { userId: dto.userId, isActive: true },
      include: { workoutDays: { select: { weekDay: true, isRest: true } } },
    });

    let workoutStreak = 0;

    if (activePlan) {
      const allCompletedSessions = await prisma.workoutSession.findMany({
        where: {
          workoutDay: { workoutPlanId: activePlan.id },
          completedAt: { not: null },
        },
        include: { workoutDay: { select: { weekDay: true } } },
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

      let currentDate = dayjs.utc(dto.to);

      for (let i = 0; i < 365; i++) {
        const weekday = DAYJS_DAY_TO_WEEKDAY[currentDate.day()];

        if (plannedWeekDays.has(weekday)) {
          const dateKey = currentDate.format("YYYY-MM-DD");
          const completedWeekdays = completedByDate.get(dateKey);

          if (completedWeekdays?.has(weekday)) {
            workoutStreak++;
          } else {
            break;
          }
        }

        currentDate = currentDate.subtract(1, "day");
      }
    }

    return {
      workoutStreak,
      consistencyByDay,
      completedWorkoutsCount,
      conclusionRate,
      totalTimeInSeconds,
    };
  }
}
