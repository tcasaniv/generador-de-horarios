
import { Availability, Day } from './types';

export const DAYS_OF_WEEK: Day[] = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

export const TIME_SLOTS = [
    "07:00 - 07:50", "07:50 - 08:40", "08:50 - 09:40", "09:40 - 10:30",
    "10:40 - 11:30", "11:30 - 12:20", "12:20 - 13:10", "13:10 - 14:00",
    "14:00 - 14:50", "14:50 - 15:40", "15:50 - 16:40", "16:40 - 17:30",
    "17:40 - 18:30", "18:30 - 19:20", "19:20 - 20:10", "20:10 - 21:00"
];

export const FULL_AVAILABILITY: Availability = DAYS_OF_WEEK.reduce((acc, day) => {
    acc[day] = Array(TIME_SLOTS.length).fill(true);
    return acc;
}, {} as Availability);

export const EMPTY_AVAILABILITY: Availability = DAYS_OF_WEEK.reduce((acc, day) => {
    acc[day] = Array(TIME_SLOTS.length).fill(false);
    return acc;
}, {} as Availability);
