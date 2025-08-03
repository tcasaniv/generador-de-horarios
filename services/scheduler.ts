import {
  AppState,
  Course,
  Teacher,
  Room,
  ScheduleEntry,
  SemesterCourse,
  StudentGroup,
  Day,
  SessionType,
  SemesterCourseGroup,
  ClassUnit,
  UnscheduledUnit,
  Conflict,
  ScheduleConflict,
} from "../types";
import { DAYS_OF_WEEK, TIME_SLOTS } from "../constants";

// Helper to generate unique IDs
const generateId = () =>
  `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Availability matrices for fast lookups
interface AvailabilityMatrices {
  teachers: { [teacherId: string]: boolean[][] };
  rooms: { [roomId: string]: boolean[][] };
  studentGroups: { [groupId: string]: boolean[][] }; // Keyed by general group ID, e.g., "4-A"
}

// Function to get the year from a course code
export const getCourseYear = (courseId: string): number | null => {
  if (courseId.length >= 4) {
    // [Plan de estudios (dos dígitos)][Año de estudios (2 dígitos)]...
    const yearStr = courseId.substring(2, 4);
    const year = parseInt(yearStr, 10);
    return isNaN(year) ? null : year;
  }
  return null;
};

// Creates the availability matrices from the raw data
const createAvailabilityMatrices = (
  teachers: Teacher[],
  rooms: Room[],
  studentGroups: StudentGroup[],
  existingSchedule: ScheduleEntry[] = [],
  ignoreEntryId?: string
): AvailabilityMatrices => {
  const matrices: AvailabilityMatrices = {
    teachers: {},
    rooms: {},
    studentGroups: {},
  };
  const dayMap = Object.fromEntries(DAYS_OF_WEEK.map((day, i) => [day, i]));

  teachers.forEach((t) => {
    matrices.teachers[t.id] = DAYS_OF_WEEK.map(
      (day) =>
        t.availability[day]?.slice() || Array(TIME_SLOTS.length).fill(false)
    );
  });
  rooms.forEach((r) => {
    matrices.rooms[r.id] = DAYS_OF_WEEK.map(
      (day) =>
        r.availability[day]?.slice() || Array(TIME_SLOTS.length).fill(false)
    );
  });
  studentGroups.forEach((sg) => {
    matrices.studentGroups[sg.id] = DAYS_OF_WEEK.map(
      (day) =>
        sg.availability[day]?.slice() || Array(TIME_SLOTS.length).fill(false)
    );
  });

  // Block slots from existing schedule
  existingSchedule.forEach((entry) => {
    if (entry.id === ignoreEntryId) return;

    const dayIndex = dayMap[entry.day];
    if (dayIndex === undefined) return;

    if (entry.roomId && matrices.rooms[entry.roomId])
      matrices.rooms[entry.roomId][dayIndex][entry.timeSlot] = false;
    if (entry.teacherId && matrices.teachers[entry.teacherId])
      matrices.teachers[entry.teacherId][dayIndex][entry.timeSlot] = false;

    const [coursePrefix, groupLetter] = entry.studentGroupId.split("-");
    const courseYear = getCourseYear(coursePrefix);
    const generalGroupId = courseYear ? `${courseYear}-${groupLetter}` : null;
    if (generalGroupId && matrices.studentGroups[generalGroupId]) {
      matrices.studentGroups[generalGroupId][dayIndex][entry.timeSlot] = false;
    }
  });

  return matrices;
};

// --- Core Scheduling Logic ---
const placeUnits = (
  unitsToPlace: (ClassUnit & { originalId?: string })[],
  appState: AppState,
  initialSchedule: ScheduleEntry[],
  options: { compactTeachers: boolean; compactStudents: boolean }
): { schedule: ScheduleEntry[]; unscheduled: UnscheduledUnit[] } => {
  const { teachers, rooms, studentGroups } = appState;
  const matrices = createAvailabilityMatrices(
    teachers,
    rooms,
    studentGroups,
    initialSchedule
  );
  const dayMap = Object.fromEntries(DAYS_OF_WEEK.map((day, i) => [day, i]));
  const finalSchedule = [...initialSchedule];
  const unscheduled: UnscheduledUnit[] = [];

  // Sort units: labs/practices are harder to place, so they go first.
  unitsToPlace.sort((a, b) => {
    const aScore =
      a.sessionType === "lab" ? 0 : a.sessionType === "practice" ? 1 : 2;
    const bScore =
      b.sessionType === "lab" ? 0 : b.sessionType === "practice" ? 1 : 2;
    return aScore - bScore;
  });

  for (const unit of unitsToPlace) {
    let bestSlot: {
      day: Day;
      timeSlot: number;
      roomId: string;
      score: number;
    } | null = null;
    let bestReason =
      "No se encontró un espacio disponible que cumpla todas las restricciones.";

    const teacherId = unit.teacherId;
    const [coursePrefix, groupLetter] = unit.studentGroupId.split("-");
    const courseYear = getCourseYear(coursePrefix);
    const generalStudentGroup = courseYear
      ? studentGroups.find(
          (sg) => sg.year === courseYear && sg.group === groupLetter
        )
      : null;

    let compatibleRooms = rooms.filter(
      (room) =>
        room.type === unit.requiredRoomType &&
        (unit.studentCount === 0 || room.capacity >= unit.studentCount)
    );
    if (compatibleRooms.length === 0) {
      // Fallback to 'aula' if specific room type is not available but meets capacity
      compatibleRooms = rooms.filter(
        (room) =>
          room.type === "aula" &&
          (unit.studentCount === 0 || room.capacity >= unit.studentCount)
      );
      if (compatibleRooms.length > 0) {
        bestReason = `No se encontró un '${unit.requiredRoomType}' disponible, se asignó un aula.`;
      } else {
        unscheduled.push({
          unit,
          reason: `No hay ambientes de tipo '${unit.requiredRoomType}' o 'aula' con capacidad para ${unit.studentCount} alumnos.`,
        });
        continue;
      }
    }

    let foundValidSlot = false;
    for (const room of compatibleRooms) {
      for (let i = 0; i < DAYS_OF_WEEK.length; i++) {
        const day = DAYS_OF_WEEK[i];
        for (let j = 0; j < TIME_SLOTS.length; j++) {
          // Check availability
          const isRoomFree = matrices.rooms[room.id]?.[i]?.[j] ?? false;
          const isTeacherFree =
            teacherId && !teacherId.startsWith("TBD_")
              ? matrices.teachers[teacherId]?.[i]?.[j] ?? false
              : true;
          const isStudentGroupFree = generalStudentGroup
            ? matrices.studentGroups[generalStudentGroup.id]?.[i]?.[j] ?? false
            : true;

          if (isRoomFree && isTeacherFree && isStudentGroupFree) {
            foundValidSlot = true;
            let score = 0; // Higher is better

            if (
              options.compactTeachers &&
              teacherId &&
              !teacherId.startsWith("TBD_") &&
              matrices.teachers[teacherId]
            ) {
              if (j > 0 && !matrices.teachers[teacherId]?.[i]?.[j - 1])
                score += 10;
              if (
                j < TIME_SLOTS.length - 1 &&
                !matrices.teachers[teacherId]?.[i]?.[j + 1]
              )
                score += 10;
            }
            if (
              options.compactStudents &&
              generalStudentGroup &&
              matrices.studentGroups[generalStudentGroup.id]
            ) {
              if (
                j > 0 &&
                !matrices.studentGroups[generalStudentGroup.id]?.[i]?.[j - 1]
              )
                score += 10;
              if (
                j < TIME_SLOTS.length - 1 &&
                !matrices.studentGroups[generalStudentGroup.id]?.[i]?.[j + 1]
              )
                score += 10;
            }

            if (bestSlot === null || score > bestSlot.score) {
              bestSlot = { day, timeSlot: j, roomId: room.id, score };
            }
          }
        }
      }
    }

    if (!foundValidSlot && bestSlot === null) {
      if (!generalStudentGroup)
        bestReason = `El grupo de alumnos '${groupLetter}' del año ${courseYear} no está definido.`;
      else if (!teacherId || teacherId.startsWith("TBD_"))
        bestReason = "Conflicto de disponibilidad de aula/grupo.";
      else
        bestReason = `No hay un horario común disponible para el docente, el grupo y un aula compatible.`;
    }

    if (bestSlot) {
      const { day, timeSlot, roomId } = bestSlot;
      const dayIndex = dayMap[day];

      const newEntry: ScheduleEntry = {
        id: unit.originalId || generateId(),
        courseId: unit.courseId,
        teacherId: unit.teacherId,
        roomId: roomId,
        studentGroupId: unit.studentGroupId,
        day: day,
        timeSlot: timeSlot,
        sessionType: unit.sessionType,
        isPinned: false,
      };
      finalSchedule.push(newEntry);

      // Update matrices for next iteration
      matrices.rooms[roomId][dayIndex][timeSlot] = false;
      if (
        teacherId &&
        !teacherId.startsWith("TBD_") &&
        matrices.teachers[teacherId]
      )
        matrices.teachers[teacherId][dayIndex][timeSlot] = false;
      if (generalStudentGroup && matrices.studentGroups[generalStudentGroup.id])
        matrices.studentGroups[generalStudentGroup.id][dayIndex][timeSlot] =
          false;
    } else {
      unscheduled.push({ unit, reason: bestReason });
    }
  }

  return { schedule: finalSchedule, unscheduled };
};

// Main function to generate the schedule from scratch
export const generateSchedule = (
  allCourses: Course[],
  allTeachers: Teacher[],
  allRooms: Room[],
  allStudentGroups: StudentGroup[],
  semesterPlan: SemesterCourse[],
  pinnedEntries: ScheduleEntry[],
  options: { compactTeachers: boolean; compactStudents: boolean }
): { schedule: ScheduleEntry[]; unscheduled: UnscheduledUnit[] } => {
  // 1. Create a definitive set of all locked/manual entries.
  // These will not be moved by the scheduler.
  const lockedEntriesMap = new Map<string, ScheduleEntry>();

  const addLockedEntry = (entry: ScheduleEntry) => {
    // Use a key that defines a unique class slot to handle potential duplicates.
    // A user might pin something that was also manually set in the plan.
    const key = `${entry.day}-${entry.timeSlot}-${entry.roomId}`;
    if (!lockedEntriesMap.has(key)) {
      lockedEntriesMap.set(key, entry);
    }
  };

  // Add entries pinned by the user in the schedule view
  pinnedEntries.forEach((entry) =>
    addLockedEntry({ ...entry, isPinned: true })
  );

  // Add entries manually assigned in the semester plan
  semesterPlan
    .filter((sc) => sc.isActive)
    .forEach((sc) => {
      sc.groups.forEach((g) => {
        (["theory", "practice", "lab", "seminar"] as SessionType[]).forEach(
          (sessionType) => {
            g[sessionType]?.forEach((assignment, subIndex) => {
              assignment.manualSlots?.forEach((slot) => {
                // A manual slot must have day/time. Room can be default or override.
                const roomId = slot.roomId || assignment.roomId;
                if (roomId) {
                  const studentGroupId = `${sc.courseId}-${g.group}-${
                    subIndex + 1
                  }`;
                  addLockedEntry({
                    id: generateId(),
                    courseId: sc.courseId,
                    teacherId: assignment.teacherId,
                    roomId: roomId,
                    studentGroupId: studentGroupId,
                    day: slot.day,
                    timeSlot: slot.timeSlot,
                    sessionType: sessionType,
                    isPinned: true, // Treat manual assignments as pinned
                  });
                }
              });
            });
          }
        );
      });
    });

  const initialSchedule = Array.from(lockedEntriesMap.values());

  // 2. Determine remaining units to be scheduled automatically
  const classUnitsToSchedule: ClassUnit[] = [];

  // Count the hours already covered by the locked initial schedule
  const initialCounts: { [key: string]: number } = {};
  initialSchedule.forEach((entry) => {
    const key = `${entry.studentGroupId}-${entry.sessionType}`;
    initialCounts[key] = (initialCounts[key] || 0) + 1;
  });

  // Iterate through the plan to find what's missing
  semesterPlan
    .filter((sc) => sc.isActive)
    .forEach((sc) => {
      const course = allCourses.find((c) => c.id === sc.courseId);
      if (!course) return;
      const courseYear = getCourseYear(course.id);

      sc.groups.forEach((g) => {
        const generalStudentGroup = courseYear
          ? allStudentGroups.find(
              (sg) => sg.year === courseYear && sg.group === g.group
            )
          : null;
        const studentCount = generalStudentGroup?.studentCount || 0;

        (["theory", "practice", "lab", "seminar"] as const).forEach(
          (sessionType) => {
            const requiredHours =
              (course[`${sessionType}Hours` as keyof Course] as number) || 0;

            g[sessionType]?.forEach((assignment, subIndex) => {
              const studentGroupId = `${course.id}-${g.group}-${subIndex + 1}`;
              const key = `${studentGroupId}-${sessionType}`;
              const hoursAlreadyPlaced = initialCounts[key] || 0;

              // Calculate remaining hours for this specific subgroup's session type
              // This is tricky because one group can have multiple subgroups for a session (e.g. 2 lab subgroups)
              // We assume each subgroup assignment in the plan needs `requiredHours`.
              const hoursToSchedule = Math.max(
                0,
                requiredHours - hoursAlreadyPlaced
              );

              for (let h = 0; h < hoursToSchedule; h++) {
                const teacherId =
                  assignment.teacherId ||
                  `TBD_${sc.courseId}_${g.group}${subIndex + 1}_${sessionType}`;
                classUnitsToSchedule.push({
                  courseId: course.id,
                  teacherId: teacherId,
                  studentGroupId: studentGroupId,
                  sessionType: sessionType,
                  requiredRoomType:
                    sessionType === "lab" ? "laboratorio" : "aula",
                  studentCount: studentCount,
                });
              }
            });
          }
        );
      });
    });

  // 3. Run the placement algorithm with the remaining units
  const appState = {
    courses: allCourses,
    teachers: allTeachers,
    rooms: allRooms,
    studentGroups: allStudentGroups,
    semesterPlan,
    schedule: initialSchedule,
  };
  return placeUnits(classUnitsToSchedule, appState, initialSchedule, options);
};

// Function to fix an existing schedule
export const fixSchedule = (
  allCourses: Course[],
  allTeachers: Teacher[],
  allRooms: Room[],
  allStudentGroups: StudentGroup[],
  semesterPlan: SemesterCourse[],
  currentSchedule: ScheduleEntry[],
  options: { compactTeachers: boolean; compactStudents: boolean }
): { schedule: ScheduleEntry[]; unscheduled: UnscheduledUnit[] } => {
  const appState = {
    courses: allCourses,
    teachers: allTeachers,
    rooms: allRooms,
    studentGroups: allStudentGroups,
    semesterPlan,
    schedule: currentSchedule,
  };
  const unitsToFix: (ClassUnit & { originalId: string })[] = [];
  const validSchedule: ScheduleEntry[] = [];

  // Create a temporary schedule to check against, removing one entry at a time to validate it against the rest
  for (const entry of currentSchedule) {
    const scheduleWithoutEntry = currentSchedule.filter(
      (e) => e.id !== entry.id
    );
    const tempState = { ...appState, schedule: scheduleWithoutEntry };
    const conflicts = validateMove(tempState, entry, entry.day, entry.timeSlot);

    if (conflicts.length > 0 && !entry.isPinned) {
      const courseYear = getCourseYear(entry.courseId);
      const [coursePrefix, groupLetter] = entry.studentGroupId.split("-");
      const generalStudentGroup = courseYear
        ? allStudentGroups.find(
            (sg) => sg.year === courseYear && sg.group === groupLetter
          )
        : null;

      unitsToFix.push({
        originalId: entry.id,
        courseId: entry.courseId,
        teacherId: entry.teacherId,
        studentGroupId: entry.studentGroupId,
        sessionType: entry.sessionType,
        requiredRoomType: entry.sessionType === "lab" ? "laboratorio" : "aula",
        studentCount: generalStudentGroup?.studentCount || 0,
      });
    } else {
      validSchedule.push(entry);
    }
  }

  if (unitsToFix.length === 0) {
    return { schedule: currentSchedule, unscheduled: [] };
  }

  return placeUnits(unitsToFix, appState, validSchedule, options);
};

// Function to validate a single move for Drag & Drop
export const validateMove = (
  appState: AppState,
  entryToMove: ScheduleEntry,
  newDay: Day,
  newTimeSlot: number
): Conflict[] => {
  const { teachers, rooms, studentGroups, schedule } = appState;
  const conflicts: Conflict[] = [];

  const teacher = teachers.find((t) => t.id === entryToMove.teacherId);
  const room = rooms.find((r) => r.id === entryToMove.roomId);

  const [coursePrefix, groupLetter] = entryToMove.studentGroupId.split("-");
  const courseYear = getCourseYear(coursePrefix);
  const generalStudentGroup = courseYear
    ? studentGroups.find(
        (sg) => sg.year === courseYear && sg.group === groupLetter
      )
    : null;

  // 1. Check entity availability
  if (teacher && !(teacher.availability[newDay]?.[newTimeSlot] ?? true)) {
    conflicts.push({
      type: "teacherAvailability",
      message: `Docente ${teacher.name} no está disponible.`,
    });
  }
  if (room && !(room.availability[newDay]?.[newTimeSlot] ?? true)) {
    conflicts.push({
      type: "roomAvailability",
      message: `Ambiente ${room.name} no está disponible.`,
    });
  }
  if (
    generalStudentGroup &&
    !(generalStudentGroup.availability[newDay]?.[newTimeSlot] ?? true)
  ) {
    conflicts.push({
      type: "studentGroupAvailability",
      message: `Grupo ${generalStudentGroup.id} no está disponible.`,
    });
  }

  // 2. Check for collisions with other schedule entries
  for (const entry of schedule) {
    if (entry.id === entryToMove.id) continue; // Don't check against itself

    if (entry.day === newDay && entry.timeSlot === newTimeSlot) {
      if (
        entry.teacherId &&
        entry.teacherId === entryToMove.teacherId &&
        !String(entry.teacherId).startsWith("TBD_")
      ) {
        conflicts.push({
          type: "teacher",
          message: `Docente ${teacher?.name || ""} ya tiene una clase.`,
        });
      }
      // A room can only have one class
      if (entry.roomId === entryToMove.roomId) {
        conflicts.push({
          type: "room",
          message: `Ambiente ${room?.name || ""} ya está ocupado.`,
        });
      }

      const [entryCoursePrefix, entryGroupLetter] =
        entry.studentGroupId.split("-");
      const studentGroupIdParts = entryToMove.studentGroupId.split("-");
      if (
        entryGroupLetter === studentGroupIdParts[1] &&
        getCourseYear(entryCoursePrefix) ===
          getCourseYear(studentGroupIdParts[0])
      ) {
        conflicts.push({
          type: "studentGroup",
          message: `Grupo de alumnos para el año ${getCourseYear(
            coursePrefix
          )} Grupo ${groupLetter} ya tiene una clase.`,
        });
      }
    }
  }

  return conflicts;
};

export const findAllConflicts = (state: AppState): ScheduleConflict[] => {
  const { teachers, rooms, studentGroups, schedule } = state;
  const conflicts: ScheduleConflict[] = [];
  const dayMap = Object.fromEntries(DAYS_OF_WEEK.map((day, i) => [day, i]));

  // Group entries by time slot for efficient collision detection
  const scheduleBySlot: { [key: string]: ScheduleEntry[] } = {};
  for (const entry of schedule) {
    const key = `${entry.day}-${entry.timeSlot}`;
    if (!scheduleBySlot[key]) {
      scheduleBySlot[key] = [];
    }
    scheduleBySlot[key].push(entry);
  }

  // Check for collisions within each time slot
  for (const key in scheduleBySlot) {
    const entriesInSlot = scheduleBySlot[key];
    if (entriesInSlot.length < 2) continue;

    const teachersInSlot: { [id: string]: ScheduleEntry[] } = {};
    const roomsInSlot: { [id: string]: ScheduleEntry[] } = {};
    const studentGroupsInSlot: { [id: string]: ScheduleEntry[] } = {};

    for (const entry of entriesInSlot) {
      // Teacher collisions
      if (entry.teacherId && !entry.teacherId.startsWith("TBD_")) {
        if (!teachersInSlot[entry.teacherId])
          teachersInSlot[entry.teacherId] = [];
        teachersInSlot[entry.teacherId].push(entry);
      }
      // Room collisions
      if (entry.roomId) {
        if (!roomsInSlot[entry.roomId]) roomsInSlot[entry.roomId] = [];
        roomsInSlot[entry.roomId].push(entry);
      }
      // Student group collisions
      const [coursePrefix, groupLetter] = entry.studentGroupId.split("-");
      const courseYear = getCourseYear(coursePrefix);
      const generalGroupId = courseYear ? `${courseYear}-${groupLetter}` : null;
      if (generalGroupId) {
        if (!studentGroupsInSlot[generalGroupId])
          studentGroupsInSlot[generalGroupId] = [];
        studentGroupsInSlot[generalGroupId].push(entry);
      }
    }

    const addConflict = (
      type: ScheduleConflict["type"],
      message: string,
      entries: ScheduleEntry[]
    ) => {
      // Avoid adding duplicate conflicts for the same set of entries
      const entryIds = entries
        .map((e) => e.id)
        .sort()
        .join(",");
      if (
        !conflicts.some(
          (c) => c.entryIds.sort().join(",") === entryIds && c.type === type
        )
      ) {
        conflicts.push({ type, message, entryIds: entries.map((e) => e.id) });
      }
    };

    for (const teacherId in teachersInSlot) {
      if (teachersInSlot[teacherId].length > 1) {
        const teacherName =
          teachers.find((t) => t.id === teacherId)?.name || teacherId;
        addConflict(
          "teacher",
          `Cruce de docente: ${teacherName} tiene múltiples clases a la misma hora.`,
          teachersInSlot[teacherId]
        );
      }
    }

    for (const roomId in roomsInSlot) {
      if (roomsInSlot[roomId].length > 1) {
        const roomName = rooms.find((r) => r.id === roomId)?.name || roomId;
        addConflict(
          "room",
          `Cruce de ambiente: ${roomName} está ocupado por múltiples clases a la misma hora.`,
          roomsInSlot[roomId]
        );
      }
    }

    for (const groupId in studentGroupsInSlot) {
      if (studentGroupsInSlot[groupId].length > 1) {
        addConflict(
          "studentGroup",
          `Cruce de grupo de alumnos: El grupo ${groupId} tiene múltiples clases a la misma hora.`,
          studentGroupsInSlot[groupId]
        );
      }
    }
  }

  // Check for availability violations for each entry
  for (const entry of schedule) {
    const dayIndex = dayMap[entry.day];
    if (dayIndex === undefined) continue;

    const teacher = teachers.find((t) => t.id === entry.teacherId);
    if (
      teacher &&
      !(teacher.availability[entry.day]?.[entry.timeSlot] ?? true)
    ) {
      conflicts.push({
        type: "teacherAvailability",
        message: `Conflicto de disponibilidad: El docente ${teacher.name} no está disponible en este horario.`,
        entryIds: [entry.id],
      });
    }

    const room = rooms.find((r) => r.id === entry.roomId);
    if (room && !(room.availability[entry.day]?.[entry.timeSlot] ?? true)) {
      conflicts.push({
        type: "roomAvailability",
        message: `Conflicto de disponibilidad: El ambiente ${room.name} no está disponible en este horario.`,
        entryIds: [entry.id],
      });
    }

    const [coursePrefix, groupLetter] = entry.studentGroupId.split("-");
    const courseYear = getCourseYear(coursePrefix);
    const generalStudentGroup = courseYear
      ? studentGroups.find(
          (sg) => sg.year === courseYear && sg.group === groupLetter
        )
      : null;
    if (
      generalStudentGroup &&
      !(generalStudentGroup.availability[entry.day]?.[entry.timeSlot] ?? true)
    ) {
      conflicts.push({
        type: "studentGroupAvailability",
        message: `Conflicto de disponibilidad: El grupo de alumnos ${generalStudentGroup.id} no está disponible en este horario.`,
        entryIds: [entry.id],
      });
    }
  }

  return conflicts;
};
