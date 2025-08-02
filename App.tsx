
import React, { useState, useEffect, useCallback, useMemo, ChangeEvent, useRef } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Course, Teacher, Room, ScheduleEntry, SemesterCourse, Tab, Availability, SessionType, Day, StudentGroup, SortConfig, SemesterCourseGroup, AppState, UnscheduledUnit, ClassUnit, Conflict, SubgroupAssignment, UnassignedAssignment } from './types';
import { DAYS_OF_WEEK, TIME_SLOTS, FULL_AVAILABILITY } from './constants';
import { generateSchedule, fixSchedule, validateMove, getCourseYear } from './services/scheduler';
import { Icon } from './components/icons';

// --- Helper & Hook Definitions ---

const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const downloadJson = (data: any, filename: string) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// --- Sub-Components ---

const Modal: React.FC<{ isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center noprint">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl m-4 max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-3xl leading-none">&times;</button>
                </div>
                <div className="p-6 overflow-y-auto">{children}</div>
            </div>
        </div>
    );
};

const AvailabilityEditor: React.FC<{ availability: Availability; onChange: (newAvailability: Availability) => void; }> = ({ availability, onChange }) => {
    const handleTimeSlotToggle = (day: Day, slotIndex: number) => {
        const newAvailability = JSON.parse(JSON.stringify(availability));
        newAvailability[day][slotIndex] = !newAvailability[day][slotIndex];
        onChange(newAvailability);
    };

    return (
        <div className="grid grid-cols-6 gap-1 text-xs">
            <div></div>
            {DAYS_OF_WEEK.map(day => <div key={day} className="font-bold text-center text-gray-600 dark:text-gray-400">{day.substring(0,3)}</div>)}
            {TIME_SLOTS.map((slot, slotIndex) => (
                <React.Fragment key={slot}>
                    <div className="font-semibold text-right pr-2 text-gray-600 dark:text-gray-400">{slot.split(' - ')[0]}</div>
                    {DAYS_OF_WEEK.map(day => (
                        <div key={`${day}-${slotIndex}`} className="flex justify-center items-center">
                            <button
                                type="button"
                                onClick={() => handleTimeSlotToggle(day, slotIndex)}
                                className={`w-6 h-6 rounded ${availability[day]?.[slotIndex] ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                                aria-label={`Toggle ${day} at ${slot}`}
                            />
                        </div>
                    ))}
                </React.Fragment>
            ))}
        </div>
    );
};

const Notification: React.FC<{ message: string; onDismiss: () => void }> = ({ message, onDismiss }) => {
    useEffect(() => {
        const timer = setTimeout(onDismiss, 5000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className="fixed top-20 right-5 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg z-[100] flex items-center space-x-4 animate-fade-in-down">
            <Icon name="alert" className="w-6 h-6 text-red-600" />
            <span className="font-semibold">{message}</span>
            <button onClick={onDismiss} className="text-red-500 hover:text-red-700 text-2xl leading-none">&times;</button>
        </div>
    );
};

// --- App Component ---

function App() {
    const initialState: AppState = {
        courses: [], teachers: [], rooms: [], studentGroups: [], semesterPlan: [], schedule: []
    };
    
    const [state, setState] = useState<AppState>(initialState);
    const { courses, teachers, rooms, studentGroups, semesterPlan, schedule } = state;

    const [activeTab, setActiveTab] = useState<Tab>(Tab.ASIGNATURAS);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [modalState, setModalState] = useState<{ type: string | null; data: any | null }>({ type: null, data: null });
    const [unscheduledUnits, setUnscheduledUnits] = useState<UnscheduledUnit[]>([]);
    const [notification, setNotification] = useState<string | null>(null);
    const [compactTeachers, setCompactTeachers] = useState(true);
    const [compactStudents, setCompactStudents] = useState(true);
    
    // --- Data Persistence ---
    useEffect(() => {
        if (!isLoaded) {
            try {
                const savedData = localStorage.getItem('timetableAppData');
                if (savedData) {
                    const data = JSON.parse(savedData);
                    if (window.confirm("Se encontraron datos guardados. ¿Desea cargarlos?")) {
                        setState(data);
                    }
                }
            } catch (error) {
                console.error("Failed to load data from localStorage", error);
            }
            setIsLoaded(true);
        }
    }, [isLoaded]);

    useEffect(() => {
        if (isLoaded) {
            try {
                const dataToSave = JSON.stringify(state);
                localStorage.setItem('timetableAppData', dataToSave);
            } catch (error) {
                console.error("Failed to save data to localStorage", error);
            }
        }
    }, [state, isLoaded]);

    const teacherWorkload = useMemo(() => {
        const loads: {[key: string]: { theory: number, practice: number, lab: number, seminar: number, total: number }} = {};
        for(const teacher of teachers) { loads[teacher.id] = { theory: 0, practice: 0, lab: 0, seminar: 0, total: 0 }; }
        for(const entry of schedule) {
            if (entry.teacherId && loads[entry.teacherId]) {
                const sessionType = entry.sessionType;
                loads[entry.teacherId][sessionType]++;
                loads[entry.teacherId].total++;
            }
        }
        return loads;
    }, [teachers, schedule]);

    // --- Generic CRUD Handlers ---
    const handleSave = <T extends {id: string}>(
        itemType: keyof AppState,
        newItem: T
    ) => {
        const items = state[itemType] as unknown as T[];
        
        // Prevent editing ID if data already exists
        const isEditing = modalState.data?.id && items.some(item => item.id === modalState.data.id);
        const newId = isEditing ? modalState.data.id : newItem.id;

        // Check for duplicates only if ID is being created or changed
        if (!isEditing || (isEditing && newId !== modalState.data.id)) {
            const duplicate = items.find(item => item.id === newId);
            if (duplicate) {
                alert(`Error: El código/ID '${newId}' ya está en uso. Por favor, elija uno único.`);
                return;
            }
        }
        
        let finalItem = {...newItem, id: newId };
        
        if (itemType === 'rooms') {
            finalItem = { ...finalItem, inventoryCode: newId } as unknown as T;
        }

        setState(prevState => {
            const currentItems = prevState[itemType] as unknown as T[];
            const index = currentItems.findIndex(item => item.id === finalItem.id);
            let updatedItems;
            if (index > -1) {
                updatedItems = [...currentItems];
                updatedItems[index] = finalItem;
            } else {
                updatedItems = [...currentItems, finalItem];
            }
            return { ...prevState, [itemType]: updatedItems };
        });
        setModalState({ type: null, data: null });
    };
    
    const handleDelete = (itemType: keyof AppState, idToDelete: string) => {
        if (window.confirm(`¿Está seguro de que desea eliminar este elemento? Esta acción no se puede deshacer.`)) {
            setState({
                ...state,
                [itemType]: (state[itemType] as { id: string }[]).filter(item => item.id !== idToDelete)
            });
        }
    };

    const handleDeleteSemesterGroup = (courseId: string, groupIndex: number) => {
        if (!window.confirm("¿Está seguro de que desea eliminar este grupo y todas sus asignaciones? Esta acción no se puede deshacer.")) return;
        
        setState({
            ...state,
            semesterPlan: state.semesterPlan.map(p => {
                if (p.courseId === courseId) {
                    const updatedGroups = p.groups.filter((_, i) => i !== groupIndex);
                    return { ...p, groups: updatedGroups };
                }
                return p;
            })
        });
    };

    // --- Scheduler Handlers ---
    const runScheduler = async (schedulerFn: (typeof generateSchedule)) => {
        setIsLoading(true);
        setUnscheduledUnits([]);
        await new Promise(resolve => setTimeout(resolve, 50)); // UX delay

        let baseSchedule = schedule.filter(e => e.isPinned);

        const result = schedulerFn(courses, teachers, rooms, studentGroups, semesterPlan, baseSchedule, { compactTeachers, compactStudents });
        
        setState(prev => ({ ...prev, schedule: result.schedule }));
        setUnscheduledUnits(result.unscheduled);

        if (result.unscheduled.length > 0) {
            setNotification(`Se generó el horario, pero no se pudieron asignar ${result.unscheduled.length} clases.`);
        } else {
            alert('¡Proceso de horario completado con éxito!');
        }

        setIsLoading(false);
        setActiveTab(Tab.TIMETABLE);
    };

    const handleGenerateSchedule = () => runScheduler(generateSchedule);

    const calculateScheduleDiff = (oldSchedule: ScheduleEntry[], newSchedule: ScheduleEntry[]) => {
        const oldEntryMap = new Map(oldSchedule.map(e => [e.id, e]));
        const changes: string[] = [];

        for (const newEntry of newSchedule) {
            const oldEntry = oldEntryMap.get(newEntry.id);
            const course = courses.find(c => c.id === newEntry.courseId);
            const courseName = course?.name || newEntry.courseId;

            if (oldEntry) {
                const moved = oldEntry.day !== newEntry.day || oldEntry.timeSlot !== newEntry.timeSlot;
                const roomChanged = oldEntry.roomId !== newEntry.roomId;
                
                if (moved || roomChanged) {
                    let changeDesc = `${courseName} (G${newEntry.studentGroupId.split('-')[1]}): `;
                    const details: string[] = [];
                    if (moved) {
                        details.push(`movido de ${oldEntry.day.substring(0,3)} ${TIME_SLOTS[oldEntry.timeSlot].split(' - ')[0]} a ${newEntry.day.substring(0,3)} ${TIME_SLOTS[newEntry.timeSlot].split(' - ')[0]}`);
                    }
                    if (roomChanged) {
                        const oldRoom = rooms.find(r => r.id === oldEntry.roomId)?.name || 'N/A';
                        const newRoom = rooms.find(r => r.id === newEntry.roomId)?.name || 'N/A';
                        details.push(`ambiente cambiado de ${oldRoom} a ${newRoom}`);
                    }
                    changeDesc += details.join(', ');
                    changes.push(changeDesc);
                }
            }
        }
        return changes;
    };

    const handleFixSchedule = async () => {
        setIsLoading(true);
        setUnscheduledUnits([]);
        await new Promise(resolve => setTimeout(resolve, 50));
    
        const oldSchedule = [...state.schedule];
    
        const result = fixSchedule(courses, teachers, rooms, studentGroups, semesterPlan, oldSchedule, { compactTeachers, compactStudents });
        
        setState(prev => ({ ...prev, schedule: result.schedule }));
    
        const changes = calculateScheduleDiff(oldSchedule, result.schedule);
        
        setModalState({
            type: 'fixSummary',
            data: {
                changes,
                unscheduled: result.unscheduled,
            }
        });
    
        setIsLoading(false);
    };
    
    const handleMoveEntry = (entryId: string, newDay: Day, newTimeSlot: number) => {
        const entry = schedule.find(e => e.id === entryId);
        if (!entry) return;

        const conflicts = validateMove(state, entry, newDay, newTimeSlot);
        if (conflicts.length > 0) {
            setNotification(`Movimiento inválido: ${conflicts.map(c => c.message).join(', ')}`);
            return;
        }
        
        setState(prev => ({
            ...prev,
            schedule: prev.schedule.map(e => e.id === entryId ? { ...e, day: newDay, timeSlot: newTimeSlot } : e)
        }));
    };

    const handleScheduleUpdate = (entryId: string, field: keyof ScheduleEntry, value: any) => {
         const updatedSchedule = state.schedule.map(e => e.id === entryId ? { ...e, [field]: value } : e);
         setState(prev => ({...prev, schedule: updatedSchedule}));
    };

    const handleSaveScheduleEntry = (entryData: Omit<ScheduleEntry, 'id'> & { id?: string }) => {
        const isCreating = !entryData.id;
        const entryToSave: ScheduleEntry = {
            ...entryData,
            id: entryData.id || generateId(),
            isPinned: isCreating ? true : entryData.isPinned,
        };

        const conflicts = validateMove(state, entryToSave, entryToSave.day, entryToSave.timeSlot);
        if (conflicts.length > 0) {
            setNotification(`No se puede guardar: ${conflicts.map(c => c.message).join(', ')}`);
            return;
        }

        if (isCreating) {
            setState(prev => ({ ...prev, schedule: [...prev.schedule, entryToSave] }));
        } else {
            setState(prev => ({
                ...prev,
                schedule: prev.schedule.map(e => e.id === entryToSave.id ? entryToSave : e),
            }));
        }
        setModalState({ type: null, data: null });
    };

    const handleDeleteScheduleEntry = (entryId: string) => {
        if (window.confirm("¿Está seguro de que desea eliminar esta clase del horario?")) {
            setState(prev => ({...prev, schedule: prev.schedule.filter(e => e.id !== entryId)}));
            setModalState({ type: null, data: null });
        }
    }

    const togglePinEntry = (entryId: string) => {
        const entry = schedule.find(e => e.id === entryId);
        if (!entry) return;
    
        const isNowPinned = !entry.isPinned;
    
        const updatedSchedule = schedule.map(e => e.id === entryId ? { ...e, isPinned: isNowPinned } : e);
    
        const [courseId, groupLetter, subGroupNumStr] = entry.studentGroupId.split('-');
        const subGroupIndex = parseInt(subGroupNumStr, 10) - 1;
    
        let newSemesterPlan = semesterPlan;
        if (courseId && groupLetter && subGroupIndex >= 0) {
            newSemesterPlan = semesterPlan.map(p => {
                if (p.courseId !== courseId) return p;
                
                const newGroups = p.groups.map(g => {
                    if (g.group !== groupLetter) return g;
    
                    const currentAssignment = g[entry.sessionType][subGroupIndex];
                    if (!currentAssignment) return g;
    
                    let newManualSlots;
    
                    if (isNowPinned) {
                        const slotExists = currentAssignment.manualSlots?.some(s => s.day === entry.day && s.timeSlot === entry.timeSlot);
                        if (!slotExists) {
                            newManualSlots = [...(currentAssignment.manualSlots || []), { day: entry.day, timeSlot: entry.timeSlot, roomId: entry.roomId }];
                        } else {
                            newManualSlots = currentAssignment.manualSlots;
                        }
                    } else { // Unpinning
                        newManualSlots = currentAssignment.manualSlots?.filter(
                            s => !(s.day === entry.day && s.timeSlot === entry.timeSlot)
                        ) || [];
                    }
                    
                    const newSessionAssignments = [...g[entry.sessionType]];
                    newSessionAssignments[subGroupIndex] = { ...currentAssignment, manualSlots: newManualSlots };
                    
                    return { ...g, [entry.sessionType]: newSessionAssignments };
                });
                return { ...p, groups: newGroups };
            });
        }
    
        setState(prev => ({
            ...prev,
            schedule: updatedSchedule,
            semesterPlan: newSemesterPlan
        }));
    };
    
    // --- File Handlers ---
    const handleImport = (event: ChangeEvent<HTMLInputElement>, itemType: keyof AppState) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target?.result;
                    if (typeof content === 'string') {
                        const jsonData = JSON.parse(content);
                        setState(prev => ({...prev, [itemType]: jsonData}));
                        alert('Datos importados correctamente.');
                    }
                } catch (error) {
                    console.error("Error parsing JSON file:", error);
                    alert('Error al importar el archivo. Asegúrese de que sea un JSON válido.');
                }
            };
            reader.readAsText(file);
        }
        event.target.value = ''; // Reset input
    };

    const handleSemesterPlanUpdate = useCallback((newPlan: SemesterCourse[] | ((prevPlan: SemesterCourse[]) => SemesterCourse[])) => {
        setState(prevState => ({
            ...prevState,
            semesterPlan: typeof newPlan === 'function' ? newPlan(prevState.semesterPlan) : newPlan
        }));
    }, []);

    const handleManualAssignmentSave = (
        courseId: string, 
        groupIndex: number, 
        session: SessionType, 
        subGroupIndex: number, 
        newSlots: {day: Day, timeSlot: number, roomId?: string | null}[]
    ) => {
        setState(prev => {
            const plan = prev.semesterPlan.find(p => p.courseId === courseId);
            if (!plan) return prev;
            const group = plan.groups[groupIndex];
            if (!group) return prev;
            const assignment = group[session][subGroupIndex];
            if (!assignment) return prev;
            
            const oldSlots = assignment.manualSlots || [];

            // Update plan (purely)
            const updatedPlan = prev.semesterPlan.map(p => {
                if (p.courseId !== courseId) return p;
                const newGroups = p.groups.map((g, i) => {
                    if (i !== groupIndex) return g;
                    const newSessionAssignments = g[session].map((sa, j) => {
                        if (j !== subGroupIndex) return sa;
                        return { ...sa, manualSlots: newSlots };
                    });
                    return { ...g, [session]: newSessionAssignments };
                });
                return { ...p, groups: newGroups };
            });

            // Sync schedule
            const getSlotKey = (s: {day: Day, timeSlot: number}) => `${s.day}-${s.timeSlot}`;
            const oldSlotKeys = new Set(oldSlots.map(getSlotKey));
            
            const studentGroupId = `${courseId}-${group.group}-${subGroupIndex + 1}`;
            
            // Filter out entries that correspond to old manual slots that are now removed
            const scheduleWithoutOldEntries = prev.schedule.filter(entry => {
                if (entry.studentGroupId === studentGroupId && entry.sessionType === session) {
                    const entrySlotKey = `${entry.day}-${entry.timeSlot}`;
                    if (oldSlotKeys.has(entrySlotKey)) {
                        return false; // Remove, it will be re-added if it's in newSlots
                    }
                }
                return true;
            });
            
            const newEntries = newSlots.map(slot => {
                const roomId = slot.roomId || assignment.roomId;
                if (!roomId) return null;
                return {
                    id: generateId(),
                    courseId,
                    teacherId: assignment.teacherId,
                    roomId,
                    studentGroupId,
                    day: slot.day,
                    timeSlot: slot.timeSlot,
                    sessionType: session,
                    isPinned: true,
                };
            }).filter(Boolean) as ScheduleEntry[];

            return {
                ...prev,
                semesterPlan: updatedPlan,
                schedule: [...scheduleWithoutOldEntries, ...newEntries],
            };
        });
        
        setModalState({ type: null, data: null });
    };

    const handleOpenEntryEditor = (entry: ScheduleEntry) => {
        setModalState({ type: 'editScheduleEntry', data: entry });
    };

    const handleOpenEntryCreator = (day: Day, timeSlot: number) => {
        setModalState({ type: 'createScheduleEntry', data: { day, timeSlot } });
    };

    // --- UI Render ---
    const renderContent = () => {
        switch (activeTab) {
            case Tab.ASIGNATURAS: return <AsignaturasView courses={courses} onDelete={(id) => handleDelete('courses', id)} openModal={(data) => setModalState({ type: 'course', data })} onImport={(e) => handleImport(e, 'courses')} setCourses={(c) => setState(prev => ({...prev, courses: typeof c === 'function' ? c(prev.courses) : c}))} />;
            case Tab.ROOMS: return <RoomsView rooms={rooms} onDelete={(id) => handleDelete('rooms', id)} openModal={(data) => setModalState({ type: 'room', data })} onImport={(e) => handleImport(e, 'rooms')} />;
            case Tab.TEACHERS: return <TeachersView teachers={teachers} workload={teacherWorkload} onDelete={(id) => handleDelete('teachers', id)} openModal={(data) => setModalState({ type: 'teacher', data })} onImport={(e) => handleImport(e, 'teachers')} />;
            case Tab.STUDENT_GROUPS: return <StudentGroupsView studentGroups={studentGroups} onDelete={(id) => handleDelete('studentGroups', id)} openModal={(data) => setModalState({ type: 'studentGroup', data })} onImport={(e) => handleImport(e, 'studentGroups')} />;
            case Tab.SEMESTER_PLAN: return <SemesterPlanView courses={courses} teachers={teachers} rooms={rooms} semesterPlan={semesterPlan} setSemesterPlan={handleSemesterPlanUpdate} onDeleteGroup={handleDeleteSemesterGroup} onImport={(e) => handleImport(e, 'semesterPlan')} openModal={(type, data) => setModalState({ type, data })} />;
            case Tab.TIMETABLE: return <TimetableView state={state} onMoveEntry={handleMoveEntry} onTogglePin={togglePinEntry} onScheduleUpdate={handleScheduleUpdate} unscheduledUnits={unscheduledUnits} setUnscheduledUnits={setUnscheduledUnits} teacherWorkload={teacherWorkload} openEntryCreator={handleOpenEntryCreator} openEntryEditor={handleOpenEntryEditor} />;
            case Tab.ATTENDANCE_REPORT: return <AttendanceReportView state={state}/>;
            default: return <div>Seleccione una pestaña</div>;
        }
    };

    const renderModals = () => {
        if (!modalState.type) return null;

        if (modalState.type === 'editScheduleEntry' || modalState.type === 'createScheduleEntry') {
            return (
                <Modal isOpen={true} onClose={() => setModalState({type: null, data: null})} title={modalState.type === 'editScheduleEntry' ? "Editar Entrada de Horario" : "Crear Entrada de Horario"}>
                    <ScheduleEntryForm
                        initialData={modalState.data}
                        state={state}
                        onSave={handleSaveScheduleEntry}
                        onDelete={handleDeleteScheduleEntry}
                        onClose={() => setModalState({type: null, data: null})}
                    />
                </Modal>
            )
        }
        
        if (modalState.type === 'manualAssign' && modalState.data) {
            const { courseId, groupIndex, session, subGroupIndex } = modalState.data;
            const plan = semesterPlan.find(p => p.courseId === courseId);
            const course = courses.find(c => c.id === courseId);
            if (!plan || !course) return null;
            
            const subGroup = plan.groups[groupIndex][session][subGroupIndex];
            const requiredHours = course[`${session}Hours` as keyof Course] as number || 0;

            return (
                <ManualAssignmentModal
                    isOpen={true}
                    onClose={() => setModalState({ type: null, data: null })}
                    requiredHours={requiredHours}
                    initialSlots={subGroup.manualSlots || []}
                    onSave={(newSlots) => {
                        handleManualAssignmentSave(courseId, groupIndex, session, subGroupIndex, newSlots);
                    }}
                    title={`Asignar Horas: ${course.name} (${session})`}
                />
            );
        }

        if (modalState.type === 'fixSummary' && modalState.data) {
            return (
                <Modal isOpen={true} onClose={() => setModalState({ type: null, data: null })} title="Resumen de Arreglos de Horario">
                    <div className="space-y-6">
                        <div>
                            <h4 className="font-semibold text-lg text-gray-800 dark:text-gray-200 mb-2">Cambios Realizados:</h4>
                            {modalState.data.changes.length > 0 ? (
                                <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 max-h-60 overflow-y-auto bg-gray-50 dark:bg-gray-700/50 p-3 rounded-md">
                                    {modalState.data.changes.map((change: string, index: number) => <li key={index}>{change}</li>)}
                                </ul>
                            ) : (
                                <p className="text-gray-500 dark:text-gray-400 italic">No se realizaron cambios automáticos. El horario no presentaba conflictos en elementos no fijados.</p>
                            )}
                        </div>
                        {modalState.data.unscheduled.length > 0 && (
                            <div>
                               <h4 className="font-semibold text-lg text-red-600 dark:text-red-400 mb-2">Clases que no se pudieron reasignar:</h4>
                               <ul className="list-disc list-inside space-y-1 text-red-700 dark:text-red-300 max-h-60 overflow-y-auto bg-red-50 dark:bg-red-900/50 p-3 rounded-md">
                                   {modalState.data.unscheduled.map((u: UnscheduledUnit, i: number) => {
                                        const course = courses.find(c => c.id === u.unit.courseId);
                                        return <li key={i}><strong>{course?.name || u.unit.courseId}</strong>: {u.reason}</li>
                                   })}
                               </ul>
                            </div>
                        )}
                        <div className="flex justify-end pt-4">
                           <button onClick={() => setModalState({ type: null, data: null })} className="px-4 py-2 bg-teal-600 text-white font-semibold rounded-md hover:bg-teal-700">Entendido</button>
                        </div>
                    </div>
                </Modal>
            )
        }
        
        const formConfig = {
            course: { title: "Curso", fields: [
                { name: 'id', label: 'Código', type: 'text', required: true },
                { name: 'name', label: 'Nombre', type: 'text', required: true, className: 'md:col-span-2' },
                { name: 'credits', label: 'Créditos', type: 'number', required: true },
                { name: 'theoryHours', label: 'Horas Teoría', type: 'number' },
                { name: 'practiceHours', label: 'Horas Práctica', type: 'number' },
                { name: 'theoryPracticeHours', label: 'Horas T-Práctica', type: 'number' },
                { name: 'labHours', label: 'Horas Lab', type: 'number' },
                { name: 'seminarHours', label: 'Horas Seminario', type: 'number' },
                { name: 'academicDepartments', label: 'Dptos. Académicos (coma-sep)', type: 'text', isArray: true, className: 'md:col-span-2' },
                { name: 'prerequisites', label: 'Pre-requisitos (códigos coma-sep)', type: 'text', isArray: true, className: 'md:col-span-2' },
                { name: 'prerequisiteCredits', label: 'Créditos Pre-req.', type: 'number' },
                { name: 'competencia', label: 'Competencia', type: 'text' },
            ]},
            room: { title: "Ambiente", fields: [
                { name: 'id', label: 'Código de Ambiente', type: 'text', required: true },
                { name: 'name', label: 'Nombre', type: 'text', required: true },
                { name: 'capacity', label: 'Aforo', type: 'number', required: true },
                { name: 'type', label: 'Tipo', type: 'select', options: ['aula', 'laboratorio', 'taller'], required: true },
                { name: 'suneduCode', label: 'Código SUNEDU', type: 'text' },
            ]},
            teacher: { title: "Docente", fields: [
                 { name: 'id', label: 'DNI', type: 'text', required: true },
                 { name: 'name', label: 'Nombre Completo', type: 'text', required: true },
                 { name: 'email', label: 'Email', type: 'email' },
                 { name: 'phone', label: 'Teléfono', type: 'tel' },
                 { name: 'type', label: 'Tipo', type: 'select', options: ['nombrado', 'contratado'], required: true },
                 { name: 'dedication', label: 'Dedicación (Ej: T.C.)', type: 'text' },
                 { name: 'academicDepartment', label: 'Dpto. Académico', type: 'text' },
            ]},
            studentGroup: { title: "Grupo de Alumnos", fields: [
                { name: 'id', label: 'Identificador (Año-Grupo, ej: 4-A)', type: 'text', required: true },
                { name: 'year', label: 'Año de Estudios', type: 'number', required: true },
                { name: 'group', label: 'Grupo (Letra)', type: 'text', required: true },
                { name: 'studentCount', label: 'Nº Alumnos', type: 'number', required: true },
            ]}
        };
        
        // @ts-ignore
        const config = formConfig[modalState.type];
        if (!config) return null;

        return (
            <Modal isOpen={true} onClose={() => setModalState({ type: null, data: null })} title={`Editar/Añadir ${config.title}`}>
                <GenericForm 
                    fields={config.fields}
                    initialData={modalState.data}
                    // @ts-ignore
                    onSave={(data) => handleSave(modalState.type + 's', data)}
                    onClose={() => setModalState({ type: null, data: null })}
                    // @ts-ignore
                    availabilityComponent={modalState.type === 'teacher' || modalState.type === 'room' || modalState.type === 'studentGroup'}
                />
            </Modal>
        );
    };

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="min-h-screen flex flex-col">
                {notification && <Notification message={notification} onDismiss={() => setNotification(null)} />}
                <header className="bg-white dark:bg-gray-800 shadow-md p-4 flex justify-between items-center noprint">
                    <div className="flex items-center space-x-3">
                        <Icon name="calendar" className="w-8 h-8 text-teal-600" />
                        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Generador de Horarios Pro</h1>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                            <div className="flex flex-col items-center">
                                <label className="flex items-center space-x-2 text-sm cursor-pointer">
                                    <input type="checkbox" checked={compactTeachers} onChange={() => setCompactTeachers(!compactTeachers)} className="h-4 w-4 rounded text-teal-600 focus:ring-teal-500"/>
                                    <span>Compactar Docentes</span>
                                </label>
                                 <label className="flex items-center space-x-2 text-sm cursor-pointer">
                                    <input type="checkbox" checked={compactStudents} onChange={() => setCompactStudents(!compactStudents)} className="h-4 w-4 rounded text-teal-600 focus:ring-teal-500"/>
                                    <span>Compactar Alumnos</span>
                                 </label>
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            <button onClick={handleFixSchedule} disabled={isLoading} className="bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-amber-700 disabled:bg-gray-400 flex items-center space-x-2">
                                <Icon name="wrench" className="w-5 h-5" />
                                <span>{isLoading ? '...' : 'Arreglar Horario'}</span>
                            </button>
                            <button onClick={handleGenerateSchedule} disabled={isLoading} className="bg-teal-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-teal-700 disabled:bg-gray-400 flex items-center space-x-2">
                                <Icon name="brain" className="w-5 h-5" />
                                <span>{isLoading ? 'Generando...' : 'Generar Horario'}</span>
                            </button>
                        </div>
                    </div>
                </header>

                <nav className="bg-gray-100 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 noprint">
                    <div className="max-w-7xl mx-auto px-4">
                        <div className="flex justify-start space-x-4 overflow-x-auto">
                            {Object.values(Tab).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`py-3 px-2 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === tab ? 'border-teal-500 text-teal-600 dark:border-teal-400 dark:text-teal-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'}`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>
                    </div>
                </nav>

                <main className="flex-grow p-6 bg-gray-50 dark:bg-gray-900">
                    {isLoading && (
                        <div className="fixed inset-0 bg-white dark:bg-gray-900 bg-opacity-75 dark:bg-opacity-75 z-50 flex flex-col justify-center items-center">
                            <div className="w-16 h-16 border-4 border-teal-500 border-dashed rounded-full animate-spin"></div>
                            <p className="mt-4 text-lg font-semibold text-gray-700 dark:text-gray-200">Procesando horario...</p>
                        </div>
                    )}
                    {renderContent()}
                </main>
                
                {renderModals()}
            </div>
        </DndProvider>
    );
}

// --- Generic Form Component ---
interface GenericFormField {
    name: string;
    label: string;
    type: string;
    required?: boolean;
    options?: string[];
    isArray?: boolean;
    className?: string;
}

interface GenericFormProps {
    fields: GenericFormField[];
    initialData: any;
    onSave: (data: any) => void;
    onClose: () => void;
    availabilityComponent?: boolean;
}

const GenericForm: React.FC<GenericFormProps> = ({ fields, initialData, onSave, onClose, availabilityComponent = false }) => {
    const [formData, setFormData] = useState(() => {
        const baseData = fields.reduce((acc, field) => {
            const initialValue = initialData?.[field.name];
            if (field.isArray && Array.isArray(initialValue)) {
                acc[field.name] = initialValue.join(', ');
            } else {
                 acc[field.name] = initialValue ?? (field.type === 'number' ? 0 : '');
                 if(field.type === 'number' && acc[field.name] === '') {
                     acc[field.name] = 0;
                 }
            }
            return acc;
        }, {} as any);
        if (availabilityComponent) {
            baseData.availability = initialData?.availability ?? JSON.parse(JSON.stringify(FULL_AVAILABILITY));
        }
        return baseData;
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        // @ts-ignore
        const isNumber = type === 'number';
        setFormData(prev => ({ ...prev, [name]: isNumber ? (value === '' ? '' : Number(value)) : value }));
    };

    const handleAvailabilityChange = (newAvailability: Availability) => {
        setFormData(prev => ({ ...prev, availability: newAvailability }));
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const dataToSave = { ...formData };
        fields.forEach(field => {
            if (field.isArray) {
                if (typeof dataToSave[field.name] === 'string') {
                    dataToSave[field.name] = dataToSave[field.name].split(',').map((s:string) => s.trim()).filter(Boolean);
                } else {
                    dataToSave[field.name] = [];
                }
            }
        });
        onSave(dataToSave);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                {fields.map(field => (
                    <div key={field.name} className={`flex flex-col ${field.className || ''}`}>
                        <label htmlFor={field.name} className="mb-1 font-medium text-gray-700 dark:text-gray-300">{field.label}</label>
                        {field.type === 'select' ? (
                            <select name={field.name} id={field.name} value={formData[field.name]} onChange={handleChange} required={field.required} className="p-2 border rounded-md bg-white dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 focus:ring-teal-500 focus:border-teal-500">
                                {field.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                        ) : (
                            <input type={field.type} name={field.name} id={field.name} value={formData[field.name]} onChange={handleChange} required={field.required} className="p-2 border rounded-md dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 focus:ring-teal-500 focus:border-teal-500" />
                        )}
                    </div>
                ))}
            </div>
            {availabilityComponent && (
                <div>
                    <h4 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">Disponibilidad</h4>
                    <AvailabilityEditor availability={formData.availability} onChange={handleAvailabilityChange} />
                </div>
            )}
            <div className="flex justify-end space-x-4 pt-4">
                <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700">Guardar</button>
            </div>
        </form>
    );
};

// --- View Components ---

const DataTableView = <T extends { id: string }>({ title, columns, data, onDelete, openModal, onImport }: {
    title: string;
    columns: { key: keyof T; label: string }[];
    data: T[];
    onDelete: (id: string) => void;
    openModal: (data?: any) => void;
    onImport?: (event: ChangeEvent<HTMLInputElement>) => void;
}) => {
    const [filter, setFilter] = useState('');
    const [sortConfig, setSortConfig] = useState<SortConfig<T>>(null);
    const importRef = useRef<HTMLInputElement>(null);

    const sortedData = useMemo(() => {
        let sortableItems = [...data];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                const valA = a[sortConfig.key];
                const valB = b[sortConfig.key];
                if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [data, sortConfig]);

    const filteredData = sortedData.filter(item =>
        Object.values(item).some(val =>
            String(val).toLowerCase().includes(filter.toLowerCase())
        )
    );

    const requestSort = (key: keyof T) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{title}</h2>
                <div className="flex items-center space-x-2">
                     <div className="relative">
                        <input
                            type="text"
                            placeholder="Buscar..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="pl-10 pr-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Icon name="search" className="w-5 h-5 text-gray-400" />
                        </div>
                    </div>
                    {onImport && (
                        <>
                            <input type="file" ref={importRef} onChange={onImport} accept=".json" style={{ display: 'none' }} />
                            <button onClick={() => importRef.current?.click()} className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2">
                                <Icon name="upload" className="w-5 h-5" />
                            </button>
                        </>
                    )}
                    <button onClick={() => downloadJson(data, title.toLowerCase())} className="p-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2">
                        <Icon name="download" className="w-5 h-5" />
                    </button>
                    <button onClick={() => openModal()} className="px-4 py-2 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 flex items-center space-x-2">
                        <Icon name="plus" />
                        <span>Añadir Fila</span>
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            {columns.map(col => (
                                <th key={String(col.key)} scope="col" onClick={() => requestSort(col.key)} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer">
                                    <div className="flex items-center">
                                        {col.label}
                                        {sortConfig?.key === col.key && <Icon name={sortConfig.direction === 'ascending' ? 'chevron-up' : 'chevron-down'} className="w-4 h-4 ml-2" />}
                                    </div>
                                </th>
                            ))}
                            <th scope="col" className="relative px-6 py-3">
                                <span className="sr-only">Acciones</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {filteredData.map(item => (
                            <tr key={item.id}>
                                {columns.map(col => (
                                    <td key={String(col.key)} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200">
                                       {Array.isArray(item[col.key]) ? (item[col.key] as any[]).join(', ') : String(item[col.key] ?? '')}
                                    </td>
                                ))}
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button onClick={() => openModal(item)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-4">
                                        <Icon name="pencil" />
                                    </button>
                                    <button onClick={() => onDelete(item.id)} className="text-red-600 hover:text-red-900 dark:text-red-500 dark:hover:text-red-400">
                                        <Icon name="trash" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const AsignaturasView: React.FC<{
    courses: Course[];
    onDelete: (id: string) => void;
    openModal: (data?: Course) => void;
    onImport: (e: ChangeEvent<HTMLInputElement>) => void;
    setCourses: React.Dispatch<React.SetStateAction<Course[]>>;
}> = ({ courses, onDelete, openModal, onImport }) => {
    const columns: { key: keyof Course; label: string; }[] = [
        { key: 'id', label: 'Código' },
        { key: 'name', label: 'Nombre' },
        { key: 'credits', label: 'Créd.' },
        { key: 'theoryHours', label: 'HT' },
        { key: 'practiceHours', label: 'HP' },
        { key: 'theoryPracticeHours', label: 'HTP' },
        { key: 'labHours', label: 'HL' },
        { key: 'seminarHours', label: 'HS' },
        { key: 'academicDepartments', label: 'Dptos.' },
        { key: 'prerequisites', label: 'Pre-Reqs.' },
        { key: 'prerequisiteCredits', label: 'Créd. Pre-Req.' },
    ];
    return <DataTableView title="Asignaturas" columns={columns} data={courses} onDelete={onDelete} openModal={openModal} onImport={onImport} />;
};

const RoomsView: React.FC<{ rooms: Room[], onDelete: (id: string) => void, openModal: (data?: Room) => void, onImport: (e: ChangeEvent<HTMLInputElement>) => void }> = (props) => {
    const columns: { key: keyof Room; label: string; }[] = [
        { key: 'id', label: 'Código' },
        { key: 'name', label: 'Nombre' },
        { key: 'capacity', label: 'Aforo' },
        { key: 'type', label: 'Tipo' },
        { key: 'suneduCode', label: 'Cód. SUNEDU' },
        { key: 'inventoryCode', label: 'Cód. Inventario' },
    ];
    return <DataTableView title="Ambientes" columns={columns} data={props.rooms} {...props} />;
};

const TeachersView: React.FC<{ teachers: Teacher[], workload: any, onDelete: (id: string) => void, openModal: (data?: Teacher) => void, onImport: (e: ChangeEvent<HTMLInputElement>) => void }> = ({ teachers, workload, ...props }) => {
     const dataWithWorkload = teachers.map(t => ({...t, workload: workload[t.id]?.total || 0 }));
     const columns: { key: keyof (Teacher & { workload: number }); label: string; }[] = [
        { key: 'id', label: 'DNI' },
        { key: 'name', label: 'Nombre' },
        { key: 'type', label: 'Tipo' },
        { key: 'dedication', label: 'Dedicación' },
        { key: 'academicDepartment', label: 'Dpto. Académico' },
        { key: 'email', label: 'Email' },
        { key: 'workload', label: 'Horas Asignadas'},
    ];
    // @ts-ignore
    return <DataTableView title="Docentes" columns={columns} data={dataWithWorkload} {...props} />;
};

const StudentGroupsView: React.FC<{ studentGroups: StudentGroup[], onDelete: (id: string) => void, openModal: (data?: StudentGroup) => void, onImport: (e: ChangeEvent<HTMLInputElement>) => void }> = (props) => {
    const columns: { key: keyof StudentGroup; label: string; }[] = [
        { key: 'id', label: 'ID (Año-Grupo)' },
        { key: 'year', label: 'Año' },
        { key: 'group', label: 'Grupo' },
        { key: 'studentCount', label: 'Nº Alumnos' },
    ];
    return <DataTableView title="Grupos de Alumnos" columns={columns} data={props.studentGroups} {...props} />;
};

const ManualAssignmentModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    title: string;
    requiredHours: number;
    initialSlots: { day: Day; timeSlot: number; roomId?: string | null }[];
    onSave: (slots: { day: Day; timeSlot: number; roomId?: string | null }[]) => void;
}> = ({ isOpen, onClose, title, requiredHours, initialSlots, onSave }) => {
    const [selectedSlots, setSelectedSlots] = useState(initialSlots);

    const handleSlotClick = (day: Day, timeSlot: number) => {
        const isSelected = selectedSlots.some(s => s.day === day && s.timeSlot === timeSlot);

        if (isSelected) {
            setSelectedSlots(slots => slots.filter(s => !(s.day === day && s.timeSlot === timeSlot)));
        } else {
            if (selectedSlots.length < requiredHours) {
                setSelectedSlots(slots => [...slots, { day, timeSlot, roomId: null }]);
            } else {
                alert(`Ya ha asignado el máximo de ${requiredHours} horas requeridas.`);
            }
        }
    };

    const handleSave = () => {
        onSave(selectedSlots);
    };

    const isSlotSelected = (day: Day, timeSlot: number) => {
        return selectedSlots.some(s => s.day === day && s.timeSlot === timeSlot);
    }
    
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div className="space-y-4">
                <div className="text-center p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                    <p className="font-semibold text-gray-800 dark:text-gray-200">
                        Horas Asignadas: <span className="text-teal-600 dark:text-teal-400 text-lg">{selectedSlots.length}</span> / <span className="text-lg">{requiredHours}</span>
                    </p>
                </div>
                <div className="grid grid-cols-6 gap-1 text-xs">
                    <div></div>
                    {DAYS_OF_WEEK.map(day => <div key={day} className="font-bold text-center text-gray-600 dark:text-gray-400">{day.substring(0,3)}</div>)}
                    {TIME_SLOTS.map((slot, slotIndex) => (
                        <React.Fragment key={slot}>
                            <div className="font-semibold text-right pr-2 text-gray-600 dark:text-gray-400 h-8 flex items-center justify-end">{slot.split(' - ')[0]}</div>
                            {DAYS_OF_WEEK.map(day => (
                                <div key={`${day}-${slotIndex}`} className="flex justify-center items-center">
                                    <button
                                        type="button"
                                        onClick={() => handleSlotClick(day, slotIndex)}
                                        className={`w-8 h-8 rounded transition-colors duration-150 ${isSlotSelected(day, slotIndex) ? 'bg-teal-500 hover:bg-teal-600 ring-2 ring-offset-2 ring-teal-500 dark:ring-offset-gray-800' : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500'}`}
                                        aria-label={`Toggle ${day} at ${slot}`}
                                    />
                                </div>
                            ))}
                        </React.Fragment>
                    ))}
                </div>
                 <div className="flex justify-end space-x-4 pt-4">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Cancelar</button>
                    <button type="button" onClick={handleSave} className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700">Guardar Asignación</button>
                </div>
            </div>
        </Modal>
    );
};

const SemesterPlanView: React.FC<{
    courses: Course[];
    teachers: Teacher[];
    rooms: Room[];
    semesterPlan: SemesterCourse[];
    setSemesterPlan: (update: (prev: SemesterCourse[]) => SemesterCourse[]) => void;
    onDeleteGroup: (courseId: string, groupIndex: number) => void;
    onImport: (e: ChangeEvent<HTMLInputElement>) => void;
    openModal: (type: string, data: any) => void;
}> = ({ courses, teachers, rooms, semesterPlan, setSemesterPlan, onDeleteGroup, onImport, openModal }) => {

    useEffect(() => {
        // Sync semester plan with courses
        setSemesterPlan(prevPlan => {
            const planCourseIds = new Set(prevPlan.map(p => p.courseId));
            const newCourses = courses.filter(c => !planCourseIds.has(c.id));
            const newPlanEntries: SemesterCourse[] = newCourses.map(c => ({
                courseId: c.id,
                isActive: false,
                isReprogrammed: false,
                groups: [],
            }));
            const fullPlan = [...prevPlan, ...newPlanEntries].filter(p => courses.some(c => c.id === p.courseId));
            return fullPlan;
        });
    }, [courses, setSemesterPlan]);

    const handleSemesterTypeSelect = (type: 'A' | 'B' | 'ALL') => {
        setSemesterPlan(prevPlan => prevPlan.map(p => {
            const courseCode = p.courseId;
            // The 5th character (index 4) indicates the semester. '1' for odd, '2' for even.
            const semesterDigit = courseCode.length >= 5 ? courseCode.charAt(4) : '';
    
            let isActive = false;
            if (type === 'ALL') {
                isActive = true; // Mark all as active
            } else if (type === 'A') {
                isActive = semesterDigit === '1'; // Mark if it's an odd semester course (impar)
            } else if (type === 'B') {
                isActive = semesterDigit === '2'; // Mark if it's an even semester course (par)
            }
    
            return {
                ...p,
                isActive,
                isReprogrammed: false // Reset reprogrammed status on new selection
            };
        }));
    };

    const handleToggleActive = (courseId: string) => {
        setSemesterPlan(prevPlan => prevPlan.map(p => {
            if (p.courseId === courseId) {
                const newActiveState = !p.isActive;
                const semesterDigit = p.courseId.length >= 5 ? p.courseId.charAt(4) : '';
                const selectedSemester = document.querySelector<HTMLSelectElement>('#semester-select')?.value;
                
                let isReprogrammed = false; // Default to not reprogrammed
                if (newActiveState) { // Only check for reprogramming if we are activating the course
                    if (selectedSemester === 'A' && semesterDigit !== '1') {
                        isReprogrammed = true;
                    } else if (selectedSemester === 'B' && semesterDigit !== '2') {
                        isReprogrammed = true;
                    }
                }
                
                return { ...p, isActive: newActiveState, isReprogrammed };
            }
            return p;
        }));
    };

    const handleUpdate = (courseId: string, groupIndex: number, session: SessionType, subGroupIndex: number, field: keyof SubgroupAssignment, value: any) => {
        setSemesterPlan(prev => prev.map(p => {
            if (p.courseId === courseId) {
                const newGroups = p.groups.map((g, i) => {
                    if (i === groupIndex) {
                        const newSessionAssignments = g[session].map((sa, j) => {
                            if (j === subGroupIndex) {
                                return { ...sa, [field]: value };
                            }
                            return sa;
                        });
                        return { ...g, [session]: newSessionAssignments };
                    }
                    return g;
                });
                return { ...p, groups: newGroups };
            }
            return p;
        }));
    };

    const addOrRemoveSubgroup = (courseId: string, groupIndex: number, session: SessionType, action: 'add' | 'remove') => {
        setSemesterPlan(prev => prev.map(p => {
            if (p.courseId === courseId) {
                const newGroups = p.groups.map((g, i) => {
                    if (i === groupIndex) {
                        const newGroup = { ...g };
                        const sessionArray = newGroup[session];
                        if (action === 'add') {
                            newGroup[session] = [...sessionArray, { teacherId: null, teachingMode: 'Presencial', manualSlots: [], roomId: null }];
                        } else {
                            newGroup[session] = sessionArray.slice(0, -1);
                        }
                        return newGroup;
                    }
                    return g;
                });
                return { ...p, groups: newGroups };
            }
            return p;
        }));
    };
    
    const addGroup = (courseId: string) => {
        setSemesterPlan(prev => prev.map(p => {
            if (p.courseId === courseId) {
                const nextGroupChar = String.fromCharCode('A'.charCodeAt(0) + p.groups.length);
                const newGroup: SemesterCourseGroup = { group: nextGroupChar, theory: [], practice: [], lab: [], seminar: [] };
                return { ...p, groups: [...p.groups, newGroup] };
            }
            return p;
        }));
    };
    
    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Plan de Funcionamiento</h2>
                <div className="flex items-center space-x-4">
                     <label htmlFor="semester-select" className="font-medium">Planificar Semestre:</label>
                     <select id="semester-select" onChange={(e) => handleSemesterTypeSelect(e.target.value as any)} className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600 focus:ring-teal-500 focus:border-teal-500">
                        <option value="ALL">Todos</option>
                        <option value="A">Impar</option>
                        <option value="B">Par</option>
                     </select>
                     <button onClick={() => downloadJson(semesterPlan, 'plan-funcionamiento')} className="p-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
                        <Icon name="download" />
                    </button>
                    <input type="file" id="import-plan" onChange={onImport} accept=".json" style={{ display: 'none' }} />
                    <label htmlFor="import-plan" className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
                        <Icon name="upload" />
                    </label>
                </div>
            </div>
            {semesterPlan.map(plan => {
                const course = courses.find(c => c.id === plan.courseId);
                if (!course) return null;
                return (
                    <div key={plan.courseId} className={`bg-white dark:bg-gray-800 p-4 rounded-lg shadow ${!plan.isActive ? 'opacity-60' : ''}`}>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-4">
                               <input type="checkbox" checked={plan.isActive} onChange={() => handleToggleActive(plan.courseId)} className="h-5 w-5 rounded text-teal-600 focus:ring-teal-500" />
                                <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200">{course.name} ({course.id})</h3>
                                {plan.isReprogrammed && <span className="px-2 py-1 text-xs font-semibold text-yellow-800 bg-yellow-200 rounded-full">Reprogramado</span>}
                            </div>
                            <button onClick={() => addGroup(plan.courseId)} className="px-3 py-1 bg-teal-500 text-white text-sm rounded-md hover:bg-teal-600">Añadir Grupo</button>
                        </div>
                        {plan.isActive && plan.groups.map((group, groupIndex) => (
                            <div key={groupIndex} className="border-t dark:border-gray-700 mt-2 pt-2 pl-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="text-lg font-bold text-gray-700 dark:text-gray-300">Grupo {group.group}</h4>
                                    <button onClick={() => onDeleteGroup(plan.courseId, groupIndex)}><Icon name="trash" className="text-red-500 hover:text-red-700 w-5 h-5"/></button>
                                </div>
                                {(['theory', 'practice', 'lab', 'seminar'] as SessionType[]).map(session => {
                                    const requiredHours = course[`${session}Hours` as keyof Course] as number;
                                    if(requiredHours === 0) return null;
                                    return (
                                        <div key={session} className="pl-4 mb-2">
                                            <div className="flex items-center space-x-2 mb-1">
                                                <h5 className="font-semibold capitalize text-gray-600 dark:text-gray-400">{session} ({requiredHours}h)</h5>
                                                <button onClick={() => addOrRemoveSubgroup(plan.courseId, groupIndex, session, 'add')} className="w-5 h-5 bg-green-500 text-white rounded-full flex items-center justify-center">+</button>
                                                <button onClick={() => addOrRemoveSubgroup(plan.courseId, groupIndex, session, 'remove')} className="w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center">-</button>
                                            </div>
                                            {group[session].map((subGroup, subGroupIndex) => (
                                                <SubgroupEditor 
                                                    key={subGroupIndex}
                                                    subGroup={subGroup}
                                                    teachers={teachers}
                                                    rooms={rooms}
                                                    onChange={(field, value) => handleUpdate(plan.courseId, groupIndex, session, subGroupIndex, field, value)}
                                                    requiredHours={requiredHours}
                                                    onOpenManualAssigner={() => openModal('manualAssign', { courseId: plan.courseId, groupIndex, session, subGroupIndex })}
                                                />
                                            ))}
                                        </div>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
};

const SubgroupEditor: React.FC<{
    subGroup: SubgroupAssignment;
    teachers: Teacher[];
    rooms: Room[];
    onChange: (field: keyof SubgroupAssignment, value: any) => void;
    requiredHours: number;
    onOpenManualAssigner: () => void;
}> = ({ subGroup, teachers, rooms, onChange, requiredHours, onOpenManualAssigner }) => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-2 border-l-4 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 rounded-r-md mt-1">
            <div className="md:col-span-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Docente / Modo</label>
                <div className="flex space-x-2">
                    <select value={subGroup.teacherId || ''} onChange={(e) => onChange('teacherId', e.target.value)} className="w-full p-1 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600">
                        <option value="">Sin Asignar</option>
                        {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <select value={subGroup.teachingMode || 'Presencial'} onChange={(e) => onChange('teachingMode', e.target.value as any)} className="w-auto p-1 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600">
                        <option value="Presencial">P</option>
                        <option value="Virtual">V</option>
                        <option value="Híbrido">H</option>
                    </select>
                </div>
            </div>
            <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Ambiente (Defecto)</label>
                <select value={subGroup.roomId || ''} onChange={(e) => onChange('roomId', e.target.value || null)} className="w-full p-1 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600">
                     <option value="">(Auto)</option>
                     {rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}
                </select>
            </div>
            <div className="flex items-end">
                 <button
                    type="button"
                    onClick={onOpenManualAssigner}
                    className="w-full text-center p-2 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-center space-x-2"
                >
                    <Icon name="calendar" className="w-4 h-4" />
                    <span>Horas ({subGroup.manualSlots?.length || 0}/{requiredHours})</span>
                </button>
            </div>
        </div>
    );
};

// --- TIMETABLE VIEW ---

const UnassignedAssignmentsView: React.FC<{
    assignments: UnassignedAssignment[];
    viewType: 'teacher' | 'room' | 'studentGroup';
}> = ({ assignments, viewType }) => {
    if (assignments.length === 0) return null;

    const titleMap = {
        teacher: "Cursos Asignados al Docente sin Horario Fijo",
        room: "Cursos Asignados al Ambiente sin Horario Fijo",
        studentGroup: "Cursos del Grupo sin Horario Fijo",
    };

    return (
        <div className="mt-6 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 p-4 rounded-lg noprint">
            <h3 className="font-semibold text-lg text-yellow-800 dark:text-yellow-200 mb-2">{titleMap[viewType]}</h3>
            <div className="max-h-60 overflow-y-auto">
                <ul className="divide-y divide-yellow-200 dark:divide-yellow-800">
                    {assignments.map((a, i) => (
                        <li key={i} className="py-2 px-1 text-sm text-gray-700 dark:text-gray-300">
                            <div className="flex justify-between items-center">
                                <div>
                                    <span className="font-bold">{a.courseName}</span>
                                    <span className="ml-2 capitalize text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700">{a.sessionType}</span>
                                </div>
                                <span className="font-mono text-base">{a.hours}h</span>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-x-4">
                                <span>Grupo: {a.studentGroupId.split('-').slice(1).join('-')}</span>
                                {viewType !== 'teacher' && a.teacherName && <span>Docente: {a.teacherName}</span>}
                                {viewType !== 'room' && a.roomName && <span>Ambiente Defecto: {a.roomName}</span>}
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

const TimetableView: React.FC<{
    state: AppState;
    onMoveEntry: (entryId: string, newDay: Day, newTimeSlot: number) => void;
    onTogglePin: (entryId: string) => void;
    onScheduleUpdate: (entryId: string, field: keyof ScheduleEntry, value: any) => void;
    unscheduledUnits: UnscheduledUnit[];
    setUnscheduledUnits: (units: UnscheduledUnit[]) => void;
    teacherWorkload: any;
    openEntryCreator: (day: Day, timeSlot: number) => void;
    openEntryEditor: (entry: ScheduleEntry) => void;
}> = (props) => {
    const [viewType, setViewType] = useState<'teacher' | 'room' | 'studentGroup' | 'escuela'>('escuela');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const { state } = props;
    const { teachers, rooms, studentGroups } = state;

    useEffect(() => {
        if(viewType === 'teacher' && teachers.length > 0 && !selectedId) setSelectedId(teachers[0].id);
        if(viewType === 'room' && rooms.length > 0 && !selectedId) setSelectedId(rooms[0].id);
        if(viewType === 'studentGroup' && studentGroups.length > 0 && !selectedId) setSelectedId(studentGroups[0].id);
        if(viewType === 'escuela') setSelectedId(null);
    }, [viewType, teachers, rooms, studentGroups, selectedId]);

    const unassignedAssignments = useMemo((): UnassignedAssignment[] => {
        if (!selectedId || viewType === 'escuela') {
            return [];
        }
    
        const unassigned: UnassignedAssignment[] = [];
        const scheduledCounts: { [key: string]: number } = {}; // key: studentGroupId-sessionType
    
        state.schedule.forEach(entry => {
            const key = `${entry.studentGroupId}-${entry.sessionType}`;
            scheduledCounts[key] = (scheduledCounts[key] || 0) + 1;
        });
    
        state.semesterPlan.forEach(planItem => {
            if (!planItem.isActive) return;
    
            const course = state.courses.find(c => c.id === planItem.courseId);
            if (!course) return;
            
            const courseYear = getCourseYear(course.id);
    
            planItem.groups.forEach(group => {
                const studentGroupInfo = state.studentGroups.find(sg => sg.year === courseYear && sg.group === group.group);
    
                (['theory', 'practice', 'lab', 'seminar'] as const).forEach(sessionType => {
                    const requiredHours = (course[`${sessionType}Hours` as keyof Course] as number) || 0;
                    if (requiredHours === 0) return;
    
                    group[sessionType].forEach((assignment, subIndex) => {
                        const studentGroupId = `${course.id}-${group.group}-${subIndex + 1}`;
                        const key = `${studentGroupId}-${sessionType}`;
                        const scheduledHours = scheduledCounts[key] || 0;
                        const unassignedHours = requiredHours - scheduledHours;
    
                        if (unassignedHours <= 0) return;
    
                        let isRelevant = false;
                        switch (viewType) {
                            case 'teacher':
                                if (assignment.teacherId === selectedId) isRelevant = true;
                                break;
                            case 'room':
                                if (assignment.roomId === selectedId) isRelevant = true;
                                break;
                            case 'studentGroup':
                                if (studentGroupInfo?.id === selectedId) isRelevant = true;
                                break;
                        }
    
                        if (isRelevant) {
                            const teacher = state.teachers.find(t => t.id === assignment.teacherId);
                            const room = state.rooms.find(r => r.id === assignment.roomId);
                            
                            const alreadyExists = unassigned.some(a => 
                                a.studentGroupId === studentGroupId &&
                                a.sessionType === sessionType
                            );
    
                            if (!alreadyExists) {
                                unassigned.push({
                                    courseId: course.id,
                                    courseName: course.name,
                                    sessionType: sessionType,
                                    studentGroupId: studentGroupId,
                                    teacherId: assignment.teacherId,
                                    teacherName: teacher?.name,
                                    roomId: assignment.roomId,
                                    roomName: room?.name,
                                    hours: unassignedHours,
                                });
                            }
                        }
                    });
                });
            });
        });
    
        return unassigned;
    }, [selectedId, viewType, state]);

    const handlePrint = () => window.print();

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md flex justify-between items-center noprint">
                <div className="flex items-center space-x-4">
                    <label htmlFor="view-type" className="font-medium">Ver por:</label>
                    <select id="view-type" value={viewType} onChange={e => setViewType(e.target.value as any)} className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                        <option value="escuela">Escuela</option>
                        <option value="teacher">Docente</option>
                        <option value="room">Ambiente</option>
                        <option value="studentGroup">Grupo de Alumnos</option>
                    </select>
                    {viewType !== 'escuela' && (
                         <select value={selectedId || ''} onChange={e => setSelectedId(e.target.value)} className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600">
                             {viewType === 'teacher' && teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                             {viewType === 'room' && rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                             {viewType === 'studentGroup' && studentGroups.map(sg => <option key={sg.id} value={sg.id}>{`Año ${sg.year} - Grupo ${sg.group}`}</option>)}
                         </select>
                    )}
                </div>
                 <button onClick={handlePrint} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700">Imprimir</button>
            </div>
            
            {props.unscheduledUnits.length > 0 && <UnscheduledListView units={props.unscheduledUnits} courses={state.courses} teachers={state.teachers} onDismiss={() => props.setUnscheduledUnits([])} />}
            
            <div className="print-table-container bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
                {viewType === 'escuela' ? (
                     <EscuelaView {...props} />
                ) : (
                    <>
                        <ScheduleGrid
                           key={selectedId}
                           entries={state.schedule.filter(e => {
                               if (!selectedId) return false;
                               if (viewType === 'teacher') return e.teacherId === selectedId;
                               if (viewType === 'room') return e.roomId === selectedId;
                               if (viewType === 'studentGroup') {
                                   const courseYear = getCourseYear(e.courseId);
                                   const studentGroup = studentGroups.find(sg => sg.id === selectedId);
                                   return courseYear === studentGroup?.year && e.studentGroupId.split('-')[1] === studentGroup.group;
                               }
                               return false;
                           })}
                           allCourses={state.courses}
                           allTeachers={state.teachers}
                           allRooms={state.rooms}
                           onMoveEntry={props.onMoveEntry}
                           onTogglePin={props.onTogglePin}
                           onOpenCreator={props.openEntryCreator}
                           onOpenEditor={props.openEntryEditor}
                        />
                        <UnassignedAssignmentsView assignments={unassignedAssignments} viewType={viewType} />
                    </>
                )}
            </div>
        </div>
    );
};

const ScheduleGrid: React.FC<{
    entries: ScheduleEntry[];
    allCourses: Course[];
    allTeachers: Teacher[];
    allRooms: Room[];
    onMoveEntry: (entryId: string, newDay: Day, newTimeSlot: number) => void;
    onTogglePin: (entryId: string) => void;
    onOpenCreator: (day: Day, timeSlot: number) => void;
    onOpenEditor: (entry: ScheduleEntry) => void;
}> = ({ entries, allCourses, allTeachers, allRooms, onMoveEntry, onTogglePin, onOpenCreator, onOpenEditor }) => {
    const entriesByTimeSlot = useMemo(() => {
        const grid: { [key: string]: ScheduleEntry | null } = {};
        for (const entry of entries) {
            grid[`${entry.day}-${entry.timeSlot}`] = entry;
        }
        return grid;
    }, [entries]);

    return (
         <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
                <thead>
                    <tr className="bg-gray-100 dark:bg-gray-700">
                        <th className="p-2 border dark:border-gray-600 w-32 text-xs font-medium text-gray-500 dark:text-gray-300">Hora</th>
                        {DAYS_OF_WEEK.map(day => (
                            <th key={day} className="p-2 border dark:border-gray-600 text-xs font-medium text-gray-500 dark:text-gray-300">{day}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {TIME_SLOTS.map((slot, timeIndex) => (
                        <tr key={slot}>
                            <td className="p-1 border dark:border-gray-600 text-center text-xs font-semibold bg-gray-50 dark:bg-gray-700">{slot}</td>
                            {DAYS_OF_WEEK.map(day => (
                                <TimeSlotCell key={day} day={day} timeSlot={timeIndex} entry={entriesByTimeSlot[`${day}-${timeIndex}`] || null} {...{allCourses, allTeachers, allRooms, onMoveEntry, onTogglePin, onOpenCreator, onOpenEditor}}/>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const TimeSlotCell: React.FC<{
    day: Day;
    timeSlot: number;
    entry: ScheduleEntry | null;
    allCourses: Course[];
    allTeachers: Teacher[];
    allRooms: Room[];
    onMoveEntry: (entryId: string, newDay: Day, newTimeSlot: number) => void;
    onTogglePin: (entryId: string) => void;
    onOpenCreator: (day: Day, timeSlot: number) => void;
    onOpenEditor: (entry: ScheduleEntry) => void;
}> = ({ day, timeSlot, entry, allCourses, allTeachers, allRooms, onMoveEntry, onTogglePin, onOpenCreator, onOpenEditor }) => {
    const [, drop] = useDrop(() => ({
        accept: 'SCHEDULE_ENTRY',
        drop: (item: { id: string }) => onMoveEntry(item.id, day, timeSlot),
    }), [day, timeSlot, onMoveEntry]);

    const handleDoubleClick = () => {
        if (entry) {
            onOpenEditor(entry);
        } else {
            onOpenCreator(day, timeSlot);
        }
    };

    return (
        <td ref={drop as any} onDoubleClick={handleDoubleClick} className="p-0.5 border dark:border-gray-600 h-20 w-40 align-top relative cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50">
            {entry && <ScheduleCard entry={entry} allCourses={allCourses} allTeachers={allTeachers} allRooms={allRooms} onTogglePin={onTogglePin} onDoubleClick={() => onOpenEditor(entry)} />}
        </td>
    );
};

const ScheduleCard: React.FC<{
    entry: ScheduleEntry;
    allCourses: Course[];
    allTeachers: Teacher[];
    allRooms: Room[];
    onTogglePin: (entryId: string) => void;
    onDoubleClick: (entry: ScheduleEntry) => void;
}> = ({ entry, allCourses, allTeachers, allRooms, onTogglePin, onDoubleClick }) => {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: 'SCHEDULE_ENTRY',
        item: { id: entry.id },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
    }), [entry.id]);

    const course = allCourses.find(c => c.id === entry.courseId);
    const teacher = allTeachers.find(t => t.id === entry.teacherId);
    const room = allRooms.find(r => r.id === entry.roomId);
    
    const teacherNameParts = teacher?.name.split(' ') || [];
    const teacherShortName = teacherNameParts.length > 1 ? `${teacherNameParts[0]} ${teacherNameParts[1].charAt(0)}.` : teacher?.name || 'N/A';


    const sessionTypeColors = {
        theory: 'bg-blue-100 border-blue-400 dark:bg-blue-900/50 dark:border-blue-600',
        practice: 'bg-green-100 border-green-400 dark:bg-green-900/50 dark:border-green-600',
        lab: 'bg-purple-100 border-purple-400 dark:bg-purple-900/50 dark:border-purple-600',
        seminar: 'bg-orange-100 border-orange-400 dark:bg-orange-900/50 dark:border-orange-600',
    };

    return (
        <div ref={drag as any} onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(entry); }} className={`p-1.5 rounded-md h-full text-xs shadow-sm cursor-grab ${sessionTypeColors[entry.sessionType]} ${isDragging ? 'opacity-50' : ''}`}>
            <div className="font-bold text-gray-800 dark:text-gray-100">{course?.name || entry.courseId}</div>
            <div className="text-gray-600 dark:text-gray-300">{`Grupo ${entry.studentGroupId.split('-')[1]}`}</div>
            <div className="text-gray-600 dark:text-gray-400 truncate">{teacherShortName}</div>
            <div className="text-gray-500 dark:text-gray-400 font-semibold">{room?.name || 'N/A'}</div>
            <button onClick={(e) => { e.stopPropagation(); onTogglePin(entry.id); }} className="absolute top-1 right-1 p-0.5 rounded-full hover:bg-black/10">
                <Icon name={entry.isPinned ? 'lock' : 'lock-open'} className={`w-3 h-3 ${entry.isPinned ? 'text-rose-600' : 'text-gray-500'}`} />
            </button>
        </div>
    );
};

const EscuelaView: React.FC<{
    state: AppState;
    onTogglePin: (entryId: string) => void;
    onScheduleUpdate: (entryId: string, field: keyof ScheduleEntry, value: any) => void;
    openEntryEditor: (entry: ScheduleEntry) => void;
    teacherWorkload: any;
}> = ({ state, onTogglePin, onScheduleUpdate, openEntryEditor, teacherWorkload }) => {
    const { schedule, courses, teachers, rooms, studentGroups, semesterPlan } = state;
    const [editingCell, setEditingCell] = useState<string | null>(null); // "entryId-field"

    const handleCellUpdate = (entryId: string, field: keyof ScheduleEntry, value: any) => {
        onScheduleUpdate(entryId, field, value);
        setEditingCell(null);
    };

    const scheduleData = useMemo(() => {
        return schedule.map(entry => {
            const course = courses.find(c => c.id === entry.courseId);
            const teacher = teachers.find(t => t.id === entry.teacherId);
            const room = rooms.find(r => r.id === entry.roomId);
            const [courseId, groupLetter, subGroupNumStr] = entry.studentGroupId.split('-');
            const plan = semesterPlan.find(p => p.courseId === courseId);
            const group = plan?.groups.find(g => g.group === groupLetter);
            const studentGroup = studentGroups.find(sg => sg.year === getCourseYear(courseId) && sg.group === groupLetter);

            const subGroupAssignment = group?.[entry.sessionType]?.[parseInt(subGroupNumStr) - 1];

            return {
                entry,
                course,
                teacher,
                room,
                studentGroup,
                subGroupAssignment
            };
        });
    }, [schedule, courses, teachers, rooms, studentGroups, semesterPlan]);

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-xs border-collapse">
                <thead className="bg-gray-100 dark:bg-gray-700">
                    <tr>
                        {['', 'COMP.', 'CODIGO', 'NOMBRE ASIGNATURA', 'DPTO. ACADÉMICO', 'CRED.', 'GRUPO', 'NOMBRE DEL DOCENTE', 'TOTAL HORAS', 'HT', 'HP', 'HL', 'HS', 'MODO ENSEÑANZA', 'AFORO', 'CODIGO SUNEDU', 'CODIGO INV.', 'NOMBRE AMBIENTE', 'Horario', ...DAYS_OF_WEEK].map(h => (
                            <th key={h} className="p-2 border dark:border-gray-600 font-medium text-gray-500 dark:text-gray-300 whitespace-nowrap">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {scheduleData.map(({entry, course, teacher, room, studentGroup, subGroupAssignment}) => {
                        const workload = teacher ? teacherWorkload[teacher.id] : null;
                        
                        return (
                            <tr key={entry.id} className="dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td className="p-1 border dark:border-gray-600 text-center"><button onClick={() => onTogglePin(entry.id)}><Icon name={entry.isPinned ? 'lock' : 'lock-open'} className={`w-4 h-4 ${entry.isPinned ? 'text-rose-500' : 'text-gray-400'}`} /></button></td>
                                <td className="p-1 border dark:border-gray-600">{course?.competencia}</td>
                                <td className="p-1 border dark:border-gray-600">{course?.id}</td>
                                <td className="p-1 border dark:border-gray-600">{course?.name}</td>
                                <td className="p-1 border dark:border-gray-600">{course?.academicDepartments.join(', ')}</td>
                                <td className="p-1 border dark:border-gray-600 text-center">{course?.credits}</td>
                                <td className="p-1 border dark:border-gray-600 text-center">{entry.studentGroupId.split('-')[1]}</td>
                                <td onDoubleClick={() => setEditingCell(`${entry.id}-teacherId`)} className="p-1 border dark:border-gray-600 cursor-pointer">
                                    {editingCell === `${entry.id}-teacherId` ? (
                                        <select
                                            value={entry.teacherId || ''}
                                            onChange={(e) => handleCellUpdate(entry.id, 'teacherId', e.target.value)}
                                            onBlur={() => setEditingCell(null)}
                                            autoFocus
                                            className="w-full bg-transparent border-0 focus:ring-0 p-0 dark:bg-gray-700"
                                        >
                                            <option value="">Sin Asignar</option>
                                            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        </select>
                                    ) : teacher?.name}
                                </td>
                                <td className="p-1 border dark:border-gray-600 text-center">{workload?.total}</td>
                                <td className="p-1 border dark:border-gray-600 text-center">{course?.theoryHours}</td>
                                <td className="p-1 border dark:border-gray-600 text-center">{course?.practiceHours}</td>
                                <td className="p-1 border dark:border-gray-600 text-center">{course?.labHours}</td>
                                <td className="p-1 border dark:border-gray-600 text-center">{course?.seminarHours}</td>
                                <td className="p-1 border dark:border-gray-600">{subGroupAssignment?.teachingMode ?? 'Presencial'}</td>
                                <td className="p-1 border dark:border-gray-600 text-center">{room?.capacity}</td>
                                <td className="p-1 border dark:border-gray-600">{room?.suneduCode}</td>
                                <td className="p-1 border dark:border-gray-600">{room?.inventoryCode}</td>
                                <td onDoubleClick={() => setEditingCell(`${entry.id}-roomId`)} className="p-1 border dark:border-gray-600 cursor-pointer">
                                    {editingCell === `${entry.id}-roomId` ? (
                                        <select
                                            value={entry.roomId || ''}
                                            onChange={(e) => handleCellUpdate(entry.id, 'roomId', e.target.value)}
                                            onBlur={() => setEditingCell(null)}
                                            autoFocus
                                            className="w-full bg-transparent border-0 focus:ring-0 p-0 dark:bg-gray-700"
                                        >
                                             {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                        </select>
                                    ) : room?.name}
                                </td>
                                <td className="p-1 border dark:border-gray-600 whitespace-nowrap">
                                    {`${entry.day.substring(0,3)} ${TIME_SLOTS[entry.timeSlot]}`}
                                    <button onClick={() => openEntryEditor(entry)} className="ml-2 text-blue-500 hover:text-blue-700"><Icon name="pencil" className="w-3 h-3"/></button>
                                </td>
                                {DAYS_OF_WEEK.map(day => (
                                    <td key={day} className={`p-1 border dark:border-gray-600 ${entry.day === day ? `bg-teal-200 dark:bg-teal-800/70` : ''}`}>
                                        {entry.day === day ? 'X' : ''}
                                    </td>
                                ))}
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    );
};

const UnscheduledListView: React.FC<{
    units: UnscheduledUnit[];
    courses: Course[];
    teachers: Teacher[];
    onDismiss: () => void;
}> = ({ units, courses, teachers, onDismiss }) => {
    return (
        <div className="bg-amber-100 dark:bg-amber-900/50 border border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-200 px-4 py-3 rounded-lg shadow-lg z-50 animate-fade-in-down noprint">
            <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold">Clases No Asignadas</h3>
                <button onClick={onDismiss} className="text-amber-600 hover:text-amber-800 text-2xl leading-none">&times;</button>
            </div>
            <ul className="list-disc pl-5 max-h-48 overflow-y-auto text-sm">
                {units.map((u, i) => {
                    const course = courses.find(c => c.id === u.unit.courseId);
                    const teacher = u.unit.teacherId ? teachers.find(t => t.id === u.unit.teacherId) : null;
                    return (
                        <li key={i} className="mb-1">
                            <strong>{course?.name}</strong> ({u.unit.sessionType}, Grp {u.unit.studentGroupId.split('-')[1]}-{u.unit.studentGroupId.split('-')[2]})
                            {teacher && <span className="text-xs"> / {teacher.name}</span>}
                            <span className="text-xs italic ml-2"> - {u.reason}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

const ScheduleEntryForm: React.FC<{
    initialData: Partial<ScheduleEntry>;
    state: AppState;
    onSave: (data: Omit<ScheduleEntry, 'id'> & { id?: string }) => void;
    onDelete: (id: string) => void;
    onClose: () => void;
}> = ({ initialData, state, onSave, onDelete, onClose }) => {
    const [entry, setEntry] = useState(initialData);

    const isCreating = !initialData.id;

    const [courseId, setCourseId] = useState(entry.courseId || '');
    const [groupLetter, setGroupLetter] = useState(entry.studentGroupId?.split('-')[1] || 'A');
    const [subgroup, setSubgroup] = useState(entry.studentGroupId?.split('-')[2] || '1');

    const handleFieldChange = (field: keyof ScheduleEntry, value: any) => {
        setEntry(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        if (!courseId || !entry.sessionType) {
            alert("Por favor seleccione Asignatura y Tipo de Sesión.");
            return;
        }
        const studentGroupId = `${courseId}-${groupLetter}-${subgroup}`;
        onSave({ ...entry, courseId, studentGroupId } as Omit<ScheduleEntry, 'id'> & { id?: string });
    };

    const selectedCourse = state.courses.find(c => c.id === courseId);
    const availableSessionTypes: SessionType[] = [];
    if (selectedCourse) {
        if (selectedCourse.theoryHours > 0) availableSessionTypes.push('theory');
        if (selectedCourse.practiceHours > 0) availableSessionTypes.push('practice');
        if (selectedCourse.labHours > 0) availableSessionTypes.push('lab');
        if (selectedCourse.seminarHours > 0) availableSessionTypes.push('seminar');
    }

    return (
        <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Asignatura</label>
                    <select value={courseId} onChange={(e) => setCourseId(e.target.value)} required className="mt-1 form-select">
                        <option value="" disabled>Seleccione...</option>
                        {state.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de Sesión</label>
                    <select value={entry.sessionType || ''} onChange={(e) => handleFieldChange('sessionType', e.target.value)} required className="mt-1 form-select">
                        <option value="" disabled>Seleccione...</option>
                        {availableSessionTypes.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Grupo</label>
                        <input type="text" value={groupLetter} onChange={e => setGroupLetter(e.target.value.toUpperCase())} className="mt-1 form-input" />
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sub-grupo</label>
                        <input type="number" value={subgroup} onChange={e => setSubgroup(e.target.value)} min="1" className="mt-1 form-input" />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Docente</label>
                    <select value={entry.teacherId || ''} onChange={(e) => handleFieldChange('teacherId', e.target.value || null)} className="mt-1 form-select">
                        <option value="">Sin Asignar</option>
                        {state.teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Ambiente</label>
                    <select value={entry.roomId || ''} onChange={(e) => handleFieldChange('roomId', e.target.value)} required className="mt-1 form-select">
                        <option value="" disabled>Seleccione...</option>
                        {state.rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.type})</option>)}
                    </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Día</label>
                        <select value={entry.day || ''} onChange={(e) => handleFieldChange('day', e.target.value)} className="mt-1 form-select">
                            {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Hora</label>
                        <select value={entry.timeSlot ?? ''} onChange={(e) => handleFieldChange('timeSlot', parseInt(e.target.value))} className="mt-1 form-select">
                            {TIME_SLOTS.map((ts, i) => <option key={i} value={i}>{ts}</option>)}
                        </select>
                    </div>
                </div>
            </div>
             <div className="flex items-center justify-between pt-4">
                 {!isCreating && (
                    <button type="button" onClick={() => onDelete(entry.id!)} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center space-x-2">
                        <Icon name="trash" /> <span>Eliminar</span>
                    </button>
                 )}
                 <div className="flex-grow"></div>
                <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 mr-2">Cancelar</button>
                <button type="submit" className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700">Guardar</button>
            </div>
        </form>
    );
};

const AttendanceReportView: React.FC<{ state: AppState }> = ({ state }) => {
    const [selectedDay, setSelectedDay] = useState<Day>(DAYS_OF_WEEK[0]);
    const { teachers, schedule, courses, rooms } = state;

    const dailySchedule = useMemo(() => {
        return schedule
            .filter(entry => entry.day === selectedDay)
            .sort((a, b) => a.timeSlot - b.timeSlot);
    }, [selectedDay, schedule]);

    const handlePrint = () => window.print();

    return (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
            <div className="flex justify-between items-center mb-6 noprint">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Parte de Asistencia por Día</h2>
                <div className="flex items-center space-x-4">
                    <label htmlFor="day-select" className="font-medium">Día:</label>
                    <select
                        id="day-select"
                        value={selectedDay}
                        onChange={e => setSelectedDay(e.target.value as Day)}
                        className="p-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                    >
                        {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <button onClick={handlePrint} className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700">Imprimir</button>
                </div>
            </div>
            
            <div>
                <h3 className="text-xl font-semibold mb-4 text-center">PARTE DE ASISTENCIA Y AVANCE DE SÍLABO - {selectedDay.toUpperCase()}</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse border border-gray-400 dark:border-gray-600 text-sm">
                        <thead className="bg-gray-100 dark:bg-gray-700">
                            <tr>
                                <th className="border p-2">Hora Inicio</th>
                                <th className="border p-2">Hora Fin</th>
                                <th className="border p-2">Docente</th>
                                <th className="border p-2">Año</th>
                                <th className="border p-2">Asignatura</th>
                                <th className="border p-2">Grupo/Subg.</th>
                                <th className="border p-2">Aula</th>
                                <th className="border p-2 w-1/4">Tema Avanzado</th>
                                <th className="border p-2">% Avance</th>
                                <th className="border p-2 w-1/6">Firma Docente</th>
                            </tr>
                        </thead>
                        <tbody>
                            {dailySchedule.length > 0 ? dailySchedule.map(entry => {
                                const course = courses.find(c => c.id === entry.courseId);
                                const teacher = teachers.find(t => t.id === entry.teacherId);
                                const room = rooms.find(r => r.id === entry.roomId);
                                const courseYear = getCourseYear(entry.courseId);
                                const groupParts = entry.studentGroupId.split('-');
                                const groupLetter = groupParts[1];
                                const subGroupNum = groupParts[2];

                                return (
                                    <tr key={entry.id}>
                                        <td className="border p-2 h-16 whitespace-nowrap">{TIME_SLOTS[entry.timeSlot].split(' - ')[0]}</td>
                                        <td className="border p-2 whitespace-nowrap">{TIME_SLOTS[entry.timeSlot].split(' - ')[1]}</td>
                                        <td className="border p-2">{teacher?.name || 'Sin Asignar'}</td>
                                        <td className="border p-2 text-center">{courseYear}°</td>
                                        <td className="border p-2">{course?.name}</td>
                                        <td className="border p-2 text-center">{`${groupLetter}${subGroupNum}`}</td>
                                        <td className="border p-2 text-center">{room?.name || 'N/A'}</td>
                                        <td className="border p-2"></td>
                                        <td className="border p-2"></td>
                                        <td className="border p-2"></td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan={10} className="text-center p-4 border">No hay clases programadas para este día.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default App;
