

export interface Course {
    id: string; // Course Code
    name: string;
    theoryHours: number;
    practiceHours: number;
    labHours: number;
    seminarHours: number;
    theoryPracticeHours: number;
    credits: number;
    academicDepartments: string[];
    prerequisites: string[];
    prerequisiteCredits: number;
    competencia?: string;
    description?: string;
    content?: string[];
    syllabusUrl?: string;
}

export interface Room {
    id: string; // Room Code: e.g., '26.5-103'
    name: string;
    capacity: number;
    type: 'aula' | 'laboratorio' | 'taller';
    availability: Availability;
    suneduCode?: string;
    inventoryCode?: string;
}

export interface Teacher {
    id: string; // DNI
    name: string;
    phone?: string;
    email?: string;
    availability: Availability;
    academicDepartment?: string;
    type: 'nombrado' | 'contratado';
    dedication?: string;
}

export interface StudentGroup {
    id: string; // e.g., '4-A' for 4th year, group A
    year: number;
    group: string;
    studentCount?: number;
    availability: Availability;
}

export interface SubgroupAssignment {
    teacherId: string | null;
    teachingMode?: 'Presencial' | 'Virtual' | 'Híbrido';
    roomId?: string | null; // Default room for auto-scheduling or manual slots
    manualSlots: {
        day: Day;
        timeSlot: number;
        roomId?: string | null; // Optional override for a specific slot
    }[];
}

export interface SemesterCourseGroup {
    group: string; // e.g., 'A'
    theory: SubgroupAssignment[];
    practice: SubgroupAssignment[];
    lab: SubgroupAssignment[];
    seminar: SubgroupAssignment[];
}

export interface SemesterCourse {
    courseId: string;
    isActive: boolean; // if it will be taught this semester
    isReprogrammed: boolean;
    groups: SemesterCourseGroup[];
}

export type SessionType = 'theory' | 'practice' | 'lab' | 'seminar';

export interface ScheduleEntry {
    id: string; // unique id for this entry
    courseId: string;
    teacherId: string | null;
    roomId: string;
    studentGroupId: string; // e.g., "IS08A01-A-1" -> course IS08A01, group A, subgroup 1
    day: Day;
    timeSlot: number;
    sessionType: SessionType;
    isPinned: boolean;
}

export interface Availability {
    [day: string]: boolean[]; // e.g., { 'lunes': [true, true, false, ...], ... }
}

export enum Tab {
    ASIGNATURAS = "Asignaturas",
    ROOMS = "Ambientes",
    TEACHERS = "Docentes",
    STUDENT_GROUPS = "Alumnos",
    SEMESTER_PLAN = "Plan de Funcionamiento",
    TIMETABLE = "Horarios",
    ATTENDANCE_REPORT = "Parte de Asistencia"
}

export type Day = 'Lunes' | 'Martes' | 'Miércoles' | 'Jueves' | 'Viernes';

export type SortConfig<T> = {
    key: keyof T;
    direction: 'ascending' | 'descending';
} | null;

export interface AppState {
    courses: Course[];
    teachers: Teacher[];
    rooms: Room[];
    studentGroups: StudentGroup[];
    semesterPlan: SemesterCourse[];
    schedule: ScheduleEntry[];
}

// Represents a single, 1-hour class session to be scheduled
export interface ClassUnit {
    courseId: string;
    teacherId: string | null;
    studentGroupId: string; 
    sessionType: SessionType;
    requiredRoomType: 'aula' | 'laboratorio' | 'taller';
    studentCount: number;
}

export interface UnscheduledUnit {
    unit: ClassUnit;
    reason: string;
}

export interface Conflict {
    type: 'teacher' | 'room' | 'studentGroup' | 'teacherAvailability' | 'roomAvailability' | 'studentGroupAvailability';
    message: string;
}