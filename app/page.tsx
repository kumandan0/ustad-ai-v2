"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ChangeEvent,
  type ElementType,
} from "react";
import {
  Send,
  Plus,
  Activity,
  Target,
  BarChart2,
  MessageSquare,
  LayoutList,
  FileText,
  Headphones,
  CheckCircle,
  X,
  Play,
  Eye,
  Trash2,
  GraduationCap,
  ChevronRight,
  Layers,
  ClipboardList,
  PenLine,
  Upload,
  Shuffle,
  Edit2,
  Save,
  BookOpen,
  ChevronDown,
  BookMarked,
  PlusCircle,
  ImageIcon,
} from "lucide-react";
import {
  createClient,
  deleteStoredFileUrl,
  migrateLegacyDataIfNeeded,
  resolveStoredFileUrl,
} from "@/lib/supabase/client";

interface Course {
  id: number;
  name: string;
  description: string;
  system_prompt: string;
  syllabus: string[];
  created_at?: string;
}

interface Week {
  id: number;
  course_id: number;
  week_index: number;
  title: string;
}

interface Flashcard {
  id: number;
  course_id: number;
  week_index: number;
  front: string;
  back: string;
}

interface TestQuestion {
  id: number;
  course_id: number;
  week_index: number;
  question: string;
  options: string[];
  correct_index: number;
}

interface OpenEndedQuestion {
  id: number;
  course_id: number;
  week_index: number;
  question: string;
  answer: string | null;
}

interface Material {
  id: number;
  course_id: number;
  week_index: number;
  file_type: "pdf" | "audio" | "infographic";
  file_name: string;
  file_url: string;
}

type MaterialFileType = Material["file_type"];
type WeekMaterials = Partial<Record<MaterialFileType, Material>>;
type ChatMode = "general" | "materials";

interface LearningGoal {
  id: number;
  course_id: number;
  week_index: number;
  label: string;
  topic_title: string;
  custom_label: boolean;
  progress: number;
  correct_answers: number;
  total_questions: number;
  last_attempt_at?: string;
}

const DEFAULT_COURSE: Omit<Course, "id"> = {
  name: "İnsan Hakları Hukuku",
  description: "AİHM, AYM bireysel başvuru ve BM mekanizmaları",
  system_prompt:
    "Sen İnsan Hakları Hukuku alanında uzman bir Türk hukuk asistanısın. Öğrencilere Türkçe olarak yardım ediyorsun. Yanıtların açık, pedagojik ve pratik örneklerle desteklenmiş olsun.",
  syllabus: [
    "Dersin amacının ve işleniş stratejisinin anlatılması",
    "Genel olarak insan haklarına giriş ve insan hakları felsefesi",
    "İnsan haklarının özellikleri ve hakların sınıflandırılması",
    "İnsan hakları koruma mekanizmaları",
    "BM insan hakları koruma mekanizmaları",
    "Anayasa Mahkemesi bireysel başvuru",
    "Avrupa İnsan Hakları Mahkemesinin yapısı ve işleyişi",
    "AİHM'ye bireysel başvuru ve şartlar",
    "Genel tekrar ve ödev dağıtımı",
    "Avrupa İnsan Hakları Sözleşmesindeki haklar",
    "Ödev ve sunum",
    "Ödev ve sunum",
    "Ödev ve sunum",
    "Final sınavı",
  ],
};

const parseCSV = (line: string) => {
  const result: string[] = [];
  let cur = "";
  let inQ = false;

  for (const c of line) {
    if (c === '"') {
      inQ = !inQ;
    } else if (c === "," && !inQ) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }

  result.push(cur.trim());
  return result;
};

const sortLearningGoals = (goals: LearningGoal[]) =>
  [...goals].sort((left, right) => left.week_index - right.week_index);

const getAssessmentVisual = (progress: number, totalQuestions: number, availableQuestions: number) => {
  if (availableQuestions === 0) {
    return {
      label: "Test yok",
      badgeBg: "#f3f4f6",
      badgeColor: "#6b7280",
      barColor: "#cbd5e1",
    };
  }

  if (totalQuestions === 0) {
    return {
      label: "Ölçülmedi",
      badgeBg: "#eef2ff",
      badgeColor: "#6366f1",
      barColor: "#c7d2fe",
    };
  }

  if (progress < 50) {
    return {
      label: "Geliştirilmeli",
      badgeBg: "#fee2e2",
      badgeColor: "#b91c1c",
      barColor: "#dc2626",
    };
  }

  if (progress < 70) {
    return {
      label: "Orta",
      badgeBg: "#fef3c7",
      badgeColor: "#b45309",
      barColor: "#d97706",
    };
  }

  if (progress < 85) {
    return {
      label: "İyi",
      badgeBg: "#dbeafe",
      badgeColor: "#1d4ed8",
      barColor: "#2563eb",
    };
  }

  return {
    label: "Çok iyi",
    badgeBg: "#dcfce7",
    badgeColor: "#15803d",
    barColor: "#16a34a",
  };
};

export default function UstadAI() {
  const supabaseRef = useRef<any>(null);
  if (!supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current;

  const [courses, setCourses] = useState<Course[]>([]);
  const [activeCourseId, setActiveCourseId] = useState<number | null>(null);
  const [courseDropOpen, setCourseDropOpen] = useState(false);
  const [addCourseModal, setAddCourseModal] = useState(false);
  const [newCourse, setNewCourse] = useState({
    name: "",
    description: "",
    system_prompt: "",
    weeks: 14,
  });

  const [activeTab, setActiveTab] = useState("curriculum");
  const [expandedExamWeek, setExpandedExamWeek] = useState<number | null>(null);
  const [examView, setExamView] = useState<{ weekIndex: number; type: string } | null>(null);

  const [weeks, setWeeks] = useState<Week[]>([]);
  const [flashcards, setFlashcards] = useState<Record<number, Flashcard[]>>({});
  const [testQuestions, setTestQuestions] = useState<Record<number, TestQuestion[]>>({});
  const [openEndedQuestions, setOpenEndedQuestions] = useState<
    Record<number, OpenEndedQuestion[]>
  >({});
  const [materials, setMaterials] = useState<Record<number, WeekMaterials>>({});
  const [learningGoals, setLearningGoals] = useState<LearningGoal[]>([]);

  const [editingWeek, setEditingWeek] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [addModal, setAddModal] = useState<{
    isOpen: boolean;
    type: string | null;
    weekIndex: number;
  }>({ isOpen: false, type: null, weekIndex: 0 });
  const [flashcardForm, setFlashcardForm] = useState({ front: "", back: "" });
  const [testForm, setTestForm] = useState({
    question: "",
    options: ["", "", "", ""],
    correctIndex: 0,
  });
  const [openEndedForm, setOpenEndedForm] = useState({ question: "", answer: "" });

  const [editingOE, setEditingOE] = useState<OpenEndedQuestion | null>(null);
  const [editOEForm, setEditOEForm] = useState({ question: "", answer: "" });

  const [editingGoal, setEditingGoal] = useState<LearningGoal | null>(null);
  const [editGoalForm, setEditGoalForm] = useState({ label: "" });

  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    type: MaterialFileType | null;
    url: string;
    name: string;
    weekIndex: number;
  }>({ isOpen: false, type: null, url: "", name: "", weekIndex: 0 });
  const [playMode, setPlayMode] = useState<{
    weekIndex: number;
    cards: Flashcard[];
    currentIndex: number;
    flipped: boolean;
  } | null>(null);
  const [testMode, setTestMode] = useState<{
    weekIndex: number;
    questions: TestQuestion[];
    currentIndex: number;
    selected: number | null;
    score: number;
    done: boolean;
  } | null>(null);

  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("general");
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [stats, setStats] = useState({ messages: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeCourse = courses.find((course) => course.id === activeCourseId) ?? null;

  const syncLearningGoals = useCallback(
    async (courseId: number, weeksList: Week[]) => {
      const { data: goalsData } = await supabase
        .from("learning_goals")
        .select()
        .eq("course_id", courseId)
        .order("week_index");

      const existingGoals = ((goalsData as Partial<LearningGoal>[] | null) ?? []).map((goal) => ({
        ...goal,
        week_index: Number(goal.week_index),
      }));

      const hasWeekBasedGoals =
        existingGoals.length === weeksList.length &&
        existingGoals.every((goal) => Number.isInteger(goal.week_index));

      if (!hasWeekBasedGoals) {
        if (existingGoals.length > 0) {
          await supabase.from("learning_goals").delete().eq("course_id", courseId);
        }

        const defaultGoals = weeksList.map((week) => ({
          course_id: courseId,
          week_index: week.week_index,
          label: week.title,
          topic_title: week.title,
          custom_label: false,
          progress: 0,
          correct_answers: 0,
          total_questions: 0,
        }));

        const { data: insertedGoals } = await supabase
          .from("learning_goals")
          .insert(defaultGoals)
          .select();

        setLearningGoals(
          sortLearningGoals(
            ((insertedGoals as LearningGoal[] | null) ?? []).map((goal) => ({
              ...goal,
              week_index: Number(goal.week_index),
              topic_title: String(goal.topic_title ?? goal.label ?? ""),
              custom_label: Boolean(goal.custom_label),
              progress: Number(goal.progress ?? 0),
              correct_answers: Number(goal.correct_answers ?? 0),
              total_questions: Number(goal.total_questions ?? 0),
            })),
          ),
        );
        return;
      }

      const normalizedGoals = sortLearningGoals(
        existingGoals.map((goal) => {
          const matchingWeek = weeksList.find((week) => week.week_index === goal.week_index);
          const topicTitle =
            matchingWeek?.title ??
            String(goal.topic_title ?? goal.label ?? `Hafta ${goal.week_index + 1}`);
          const customLabel =
            typeof goal.custom_label === "boolean"
              ? goal.custom_label
              : typeof goal.label === "string" && goal.label.trim().length > 0 && goal.label !== topicTitle;

          return {
            id: Number(goal.id),
            course_id: courseId,
            week_index: goal.week_index,
            label:
              customLabel && typeof goal.label === "string" && goal.label.trim().length > 0
                ? goal.label
                : topicTitle,
            topic_title: topicTitle,
            custom_label: customLabel,
            progress: Number(goal.progress ?? 0),
            correct_answers: Number(goal.correct_answers ?? 0),
            total_questions: Number(goal.total_questions ?? 0),
            last_attempt_at:
              typeof goal.last_attempt_at === "string" ? goal.last_attempt_at : undefined,
          };
        }),
      );

      const updates = normalizedGoals.flatMap((goal) => {
        const original = existingGoals.find((item) => Number(item.id) === goal.id);
        if (!original) {
          return [];
        }

        const payload: Partial<LearningGoal> = {};
        if (original.label !== goal.label) {
          payload.label = goal.label;
        }
        if (original.topic_title !== goal.topic_title) {
          payload.topic_title = goal.topic_title;
        }
        if (original.custom_label !== goal.custom_label) {
          payload.custom_label = goal.custom_label;
        }
        if (original.correct_answers === undefined) {
          payload.correct_answers = goal.correct_answers;
        }
        if (original.total_questions === undefined) {
          payload.total_questions = goal.total_questions;
        }

        if (Object.keys(payload).length === 0) {
          return [];
        }

        return [supabase.from("learning_goals").update(payload).eq("id", goal.id)];
      });

      if (updates.length > 0) {
        await Promise.all(updates);
      }

      setLearningGoals(normalizedGoals);
    },
    [supabase],
  );

  const loadCourses = useCallback(async () => {
    const { data } = await supabase.from("courses").select().order("created_at");

    if (data && data.length > 0) {
      const parsed = data.map((course) => ({
        ...course,
        syllabus:
          typeof course.syllabus === "string"
            ? (JSON.parse(course.syllabus) as string[])
            : ((course.syllabus as string[]) ?? []),
      })) as Course[];

      setCourses(parsed);
      setActiveCourseId(parsed[0].id);
      return;
    }

    const { data: inserted } = await supabase
      .from("courses")
      .insert({ ...DEFAULT_COURSE, syllabus: JSON.stringify(DEFAULT_COURSE.syllabus) })
      .select()
      .single();

    if (inserted) {
      const parsed = {
        ...(inserted as Course),
        syllabus: JSON.parse(String(inserted.syllabus ?? "[]")) as string[],
      };
      setCourses([parsed]);
      setActiveCourseId(parsed.id);
    }
  }, [supabase]);

  const loadCourseData = useCallback(
    async (courseId: number) => {
      setDataLoading(true);

      try {
        let resolvedWeeks: Week[] = [];

        const { data: weeksData } = await supabase
          .from("weeks")
          .select()
          .eq("course_id", courseId)
          .order("week_index");

        if (weeksData && weeksData.length > 0) {
          resolvedWeeks = weeksData as Week[];
          setWeeks(resolvedWeeks);
        } else {
          const course = courses.find((item) => item.id === courseId);
          if (course) {
            const defaultWeeks = course.syllabus.map((title, index) => ({
              course_id: courseId,
              week_index: index,
              title,
            }));
            const { data: insertedWeeks } = await supabase.from("weeks").insert(defaultWeeks).select();
            if (insertedWeeks) {
              resolvedWeeks = insertedWeeks as Week[];
              setWeeks(resolvedWeeks);
            }
          }
        }

        const { data: flashcardsData } = await supabase
          .from("flashcards")
          .select()
          .eq("course_id", courseId)
          .order("created_at");

        if (flashcardsData) {
          const grouped: Record<number, Flashcard[]> = {};
          flashcardsData.forEach((flashcard) => {
            if (!grouped[Number(flashcard.week_index)]) {
              grouped[Number(flashcard.week_index)] = [];
            }
            grouped[Number(flashcard.week_index)].push(flashcard as Flashcard);
          });
          setFlashcards(grouped);
        } else {
          setFlashcards({});
        }

        const { data: testsData } = await supabase
          .from("test_questions")
          .select()
          .eq("course_id", courseId)
          .order("created_at");

        if (testsData) {
          const grouped: Record<number, TestQuestion[]> = {};
          testsData.forEach((question) => {
            const weekIndex = Number(question.week_index);
            if (!grouped[weekIndex]) {
              grouped[weekIndex] = [];
            }
            grouped[weekIndex].push({
              ...(question as TestQuestion),
              options: (question.options as string[]) ?? [],
            });
          });
          setTestQuestions(grouped);
        } else {
          setTestQuestions({});
        }

        const { data: openEndedData } = await supabase
          .from("open_ended_questions")
          .select()
          .eq("course_id", courseId)
          .order("created_at");

        if (openEndedData) {
          const grouped: Record<number, OpenEndedQuestion[]> = {};
          openEndedData.forEach((question) => {
            const weekIndex = Number(question.week_index);
            if (!grouped[weekIndex]) {
              grouped[weekIndex] = [];
            }
            grouped[weekIndex].push(question as OpenEndedQuestion);
          });
          setOpenEndedQuestions(grouped);
        } else {
          setOpenEndedQuestions({});
        }

        const { data: materialsData } = await supabase
          .from("materials")
          .select()
          .eq("course_id", courseId);

        if (materialsData) {
          const resolvedMaterials = await Promise.all(
            materialsData.map(async (material) => ({
              ...(material as Material),
              file_url: await resolveStoredFileUrl(String(material.file_url ?? "")),
            })),
          );

          const grouped: Record<number, WeekMaterials> = {};
          resolvedMaterials.forEach((material) => {
            const weekIndex = Number(material.week_index);
            if (!grouped[weekIndex]) {
              grouped[weekIndex] = {};
            }
            grouped[weekIndex][material.file_type as MaterialFileType] = material;
          });
          setMaterials(grouped);
        } else {
          setMaterials({});
        }

        if (resolvedWeeks.length > 0) {
          await syncLearningGoals(courseId, resolvedWeeks);
        } else {
          setLearningGoals([]);
        }
      } catch (error) {
        console.error(error);
      }

      setDataLoading(false);
    },
    [courses, supabase, syncLearningGoals],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        await migrateLegacyDataIfNeeded();
      } catch (error) {
        console.error(error);
      }

      if (!cancelled) {
        void loadCourses();
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [loadCourses]);

  useEffect(() => {
    if (activeCourseId !== null && courses.length > 0) {
      setWeeks([]);
      setFlashcards({});
      setTestQuestions({});
      setOpenEndedQuestions({});
      setMaterials({});
      setLearningGoals([]);
      setMessages([]);
      setExamView(null);
      setExpandedExamWeek(null);
      void loadCourseData(activeCourseId);
    }
  }, [activeCourseId, courses.length, loadCourseData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const getWeekTitle = (weekIndex: number) => {
    const week = weeks.find((item) => item.week_index === weekIndex);
    if (week) {
      return week.title;
    }

    return activeCourse?.syllabus[weekIndex] ?? `Hafta ${weekIndex + 1}`;
  };

  const weekCount = activeCourse?.syllabus.length ?? 14;

  const saveAssessmentResult = useCallback(
    async (weekIndex: number, correctAnswers: number, totalQuestions: number) => {
      if (!activeCourseId || totalQuestions <= 0) {
        return;
      }

      const matchingWeek = weeks.find((week) => week.week_index === weekIndex);
      const topicTitle =
        matchingWeek?.title ?? activeCourse?.syllabus[weekIndex] ?? `Hafta ${weekIndex + 1}`;
      const progress = Math.round((correctAnswers / totalQuestions) * 100);
      const payload = {
        topic_title: topicTitle,
        progress,
        correct_answers: correctAnswers,
        total_questions: totalQuestions,
        last_attempt_at: new Date().toISOString(),
      };

      const existingGoal = learningGoals.find((goal) => goal.week_index === weekIndex);

      if (existingGoal) {
        const nextGoal = existingGoal.custom_label
          ? { ...existingGoal, ...payload }
          : { ...existingGoal, ...payload, label: topicTitle };
        await supabase
          .from("learning_goals")
          .update(existingGoal.custom_label ? payload : { ...payload, label: topicTitle })
          .eq("id", existingGoal.id);
        setLearningGoals((prev) =>
          sortLearningGoals(prev.map((goal) => (goal.id === existingGoal.id ? nextGoal : goal))),
        );
        return;
      }

      const { data, error } = await supabase
        .from("learning_goals")
        .insert({
          course_id: activeCourseId,
          week_index: weekIndex,
          label: topicTitle,
          custom_label: false,
          ...payload,
        })
        .select()
        .single();

      if (!error && data) {
        setLearningGoals((prev) =>
          sortLearningGoals([
            ...prev,
            {
              ...(data as LearningGoal),
              week_index: Number(data.week_index),
              topic_title: String(data.topic_title ?? data.label ?? ""),
              custom_label: Boolean(data.custom_label),
              progress: Number(data.progress ?? 0),
              correct_answers: Number(data.correct_answers ?? 0),
              total_questions: Number(data.total_questions ?? 0),
            },
          ]),
        );
      }
    },
    [activeCourse, activeCourseId, learningGoals, supabase, weeks],
  );

  const handleAddCourse = async () => {
    if (!newCourse.name.trim()) {
      return;
    }

    const syllabus = Array.from(
      { length: newCourse.weeks },
      (_, index) => `Hafta ${index + 1} Konusu`,
    );

    const { data, error } = await supabase
      .from("courses")
      .insert({
        name: newCourse.name,
        description: newCourse.description,
        system_prompt:
          newCourse.system_prompt || "Sen yardımsever bir öğretmen asistanısın. Türkçe yanıt ver.",
        syllabus: JSON.stringify(syllabus),
      })
      .select()
      .single();

    if (!error && data) {
      const parsed = { ...(data as Course), syllabus } as Course;
      setCourses((prev) => [...prev, parsed]);
      setActiveCourseId(parsed.id);
    }

    setNewCourse({ name: "", description: "", system_prompt: "", weeks: 14 });
    setAddCourseModal(false);
  };

  const handleDeleteCourse = async (id: number) => {
    if (!confirm("Bu dersi silmek istediğine emin misin? Tüm içerikler silinecek.")) {
      return;
    }

    await supabase.from("courses").delete().eq("id", id);
    const remaining = courses.filter((course) => course.id !== id);
    setCourses(remaining);

    if (activeCourseId === id) {
      setActiveCourseId(remaining[0]?.id ?? null);
    }
  };

  const updateWeekTitle = async (weekIndex: number, newTitle: string) => {
    if (!activeCourseId) {
      return;
    }

    await supabase
      .from("weeks")
      .update({ title: newTitle })
      .eq("course_id", activeCourseId)
      .eq("week_index", weekIndex);

    const matchingGoal = learningGoals.find((goal) => goal.week_index === weekIndex);
    if (matchingGoal) {
      await supabase
        .from("learning_goals")
        .update(
          matchingGoal.custom_label
            ? { topic_title: newTitle }
            : { label: newTitle, topic_title: newTitle },
        )
        .eq("id", matchingGoal.id);
    }

    setWeeks((prev) =>
      prev.map((week) => (week.week_index === weekIndex ? { ...week, title: newTitle } : week)),
    );
    setLearningGoals((prev) =>
      sortLearningGoals(
        prev.map((goal) =>
          goal.week_index === weekIndex
            ? goal.custom_label
              ? { ...goal, topic_title: newTitle }
              : { ...goal, label: newTitle, topic_title: newTitle }
            : goal,
        ),
      ),
    );
    setEditingWeek(null);
  };

  const addFlashcard = async () => {
    if (!flashcardForm.front.trim() || !flashcardForm.back.trim() || !activeCourseId) {
      return;
    }

    const { data, error } = await supabase
      .from("flashcards")
      .insert({
        course_id: activeCourseId,
        week_index: addModal.weekIndex,
        front: flashcardForm.front,
        back: flashcardForm.back,
      })
      .select()
      .single();

    if (!error && data) {
      setFlashcards((prev) => ({
        ...prev,
        [addModal.weekIndex]: [...(prev[addModal.weekIndex] || []), data as Flashcard],
      }));
    }

    setFlashcardForm({ front: "", back: "" });
    setAddModal({ isOpen: false, type: null, weekIndex: 0 });
  };

  const deleteFlashcard = async (weekIndex: number, id: number) => {
    await supabase.from("flashcards").delete().eq("id", id);
    setFlashcards((prev) => ({
      ...prev,
      [weekIndex]: prev[weekIndex].filter((card) => card.id !== id),
    }));
  };

  const addTestQuestion = async () => {
    if (!testForm.question.trim() || testForm.options.some((option) => !option.trim()) || !activeCourseId) {
      return;
    }

    const { data, error } = await supabase
      .from("test_questions")
      .insert({
        course_id: activeCourseId,
        week_index: addModal.weekIndex,
        question: testForm.question,
        options: testForm.options,
        correct_index: testForm.correctIndex,
      })
      .select()
      .single();

    if (!error && data) {
      setTestQuestions((prev) => ({
        ...prev,
        [addModal.weekIndex]: [
          ...(prev[addModal.weekIndex] || []),
          { ...(data as TestQuestion), options: (data.options as string[]) ?? [] },
        ],
      }));
    }

    setTestForm({ question: "", options: ["", "", "", ""], correctIndex: 0 });
    setAddModal({ isOpen: false, type: null, weekIndex: 0 });
  };

  const deleteTestQuestion = async (weekIndex: number, id: number) => {
    await supabase.from("test_questions").delete().eq("id", id);
    setTestQuestions((prev) => ({
      ...prev,
      [weekIndex]: prev[weekIndex].filter((question) => question.id !== id),
    }));
  };

  const addOpenEnded = async () => {
    if (!openEndedForm.question.trim() || !activeCourseId) {
      return;
    }

    const { data, error } = await supabase
      .from("open_ended_questions")
      .insert({
        course_id: activeCourseId,
        week_index: addModal.weekIndex,
        question: openEndedForm.question,
        answer: openEndedForm.answer || null,
      })
      .select()
      .single();

    if (!error && data) {
      setOpenEndedQuestions((prev) => ({
        ...prev,
        [addModal.weekIndex]: [...(prev[addModal.weekIndex] || []), data as OpenEndedQuestion],
      }));
    }

    setOpenEndedForm({ question: "", answer: "" });
    setAddModal({ isOpen: false, type: null, weekIndex: 0 });
  };

  const deleteOpenEnded = async (weekIndex: number, id: number) => {
    await supabase.from("open_ended_questions").delete().eq("id", id);
    setOpenEndedQuestions((prev) => ({
      ...prev,
      [weekIndex]: prev[weekIndex].filter((question) => question.id !== id),
    }));
  };

  const startEditOE = (question: OpenEndedQuestion) => {
    setEditingOE(question);
    setEditOEForm({ question: question.question, answer: question.answer ?? "" });
  };

  const saveEditOE = async () => {
    if (!editingOE) {
      return;
    }

    const { error } = await supabase
      .from("open_ended_questions")
      .update({ question: editOEForm.question, answer: editOEForm.answer || null })
      .eq("id", editingOE.id);

    if (!error) {
      setOpenEndedQuestions((prev) => {
        const weekIndex = editingOE.week_index;
        return {
          ...prev,
          [weekIndex]: prev[weekIndex].map((question) =>
            question.id === editingOE.id
              ? { ...question, question: editOEForm.question, answer: editOEForm.answer || null }
              : question,
          ),
        };
      });
    }

    setEditingOE(null);
  };

  const startEditGoal = (goal: LearningGoal) => {
    setEditingGoal(goal);
    setEditGoalForm({ label: goal.custom_label ? goal.label : "" });
  };

  const saveEditGoal = async () => {
    if (!editingGoal) {
      return;
    }

    const trimmedLabel = editGoalForm.label.trim();
    const customLabel = trimmedLabel.length > 0 && trimmedLabel !== editingGoal.topic_title;
    const nextLabel = customLabel ? trimmedLabel : editingGoal.topic_title;
    const payload = { label: nextLabel, custom_label: customLabel };

    const { error } = await supabase
      .from("learning_goals")
      .update(payload)
      .eq("id", editingGoal.id);

    if (!error) {
      setLearningGoals((prev) =>
        sortLearningGoals(
          prev.map((goal) =>
            goal.id === editingGoal.id ? { ...goal, ...payload, label: nextLabel } : goal,
          ),
        ),
      );
    }

    setEditingGoal(null);
  };

  const handleFileUpload = async (
    weekIndex: number,
    fileType: MaterialFileType,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    if (!activeCourseId) {
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const fileExt = file.name.split(".").pop();
    const fileName = `${activeCourseId}_${weekIndex}_${fileType}_${Date.now()}.${fileExt}`;
    const filePath = `materials/${fileName}`;
    const existingMaterial = materials[weekIndex]?.[fileType];

    try {
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("law-tutor-files")
        .upload(filePath, file);

      if (uploadError || !uploadData?.publicUrl) {
        throw uploadError ?? new Error("Dosya URL'si oluşturulamadı.");
      }

      const resolvedUrl = await resolveStoredFileUrl(uploadData.publicUrl);

      const { data, error } = await supabase
        .from("materials")
        .insert({
          course_id: activeCourseId,
          week_index: weekIndex,
          file_type: fileType,
          file_name: file.name,
          file_url: resolvedUrl,
        })
        .select()
        .single();

      if (error || !data) {
        await deleteStoredFileUrl(resolvedUrl);
        throw error ?? new Error("Dosya kaydedilemedi.");
      }

      if (existingMaterial?.file_url) {
        await deleteStoredFileUrl(existingMaterial.file_url);
        await supabase.from("materials").delete().eq("id", existingMaterial.id);
      }

      const finalUrl = await resolveStoredFileUrl(String(data.file_url ?? ""));
      setMaterials((prev) => ({
        ...prev,
        [weekIndex]: {
          ...prev[weekIndex],
          [fileType]: { ...(data as Material), file_url: finalUrl || String(data.file_url ?? "") },
        },
      }));
    } catch (error) {
      console.error(error);
      alert("Dosya yüklenemedi. Lütfen daha küçük bir dosya deneyin veya sayfayı yenileyip tekrar deneyin.");
    } finally {
      event.target.value = "";
    }
  };

  const handleDeleteFile = async (weekIndex: number, fileType: MaterialFileType) => {
    if (!activeCourseId) {
      return;
    }

    const material = materials[weekIndex]?.[fileType];
    if (!material) {
      return;
    }

    await deleteStoredFileUrl(material.file_url);
    await supabase.from("materials").delete().eq("id", material.id);
    setMaterials((prev) => {
      const updated = { ...prev };
      if (updated[weekIndex]) {
        delete updated[weekIndex][fileType];
        if (
          !updated[weekIndex].audio &&
          !updated[weekIndex].pdf &&
          !updated[weekIndex].infographic
        ) {
          delete updated[weekIndex];
        }
      }
      return updated;
    });
  };

  const handleFlashcardCSV = async (weekIndex: number, event: ChangeEvent<HTMLInputElement>) => {
    if (!activeCourseId) {
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      const text = String(loadEvent.target?.result ?? "");
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const firstLine = lines[0]?.toLowerCase() || "";
      const start =
        firstLine.includes("front") ||
        firstLine.includes("on") ||
        firstLine.includes("ön") ||
        firstLine.includes("soru")
          ? 1
          : 0;

      const cards = lines.slice(start).flatMap((line) => {
        const parts = parseCSV(line);
        return parts[0]?.trim() && parts[1]?.trim()
          ? [
              {
                course_id: activeCourseId,
                week_index: weekIndex,
                front: parts[0].trim(),
                back: parts[1].trim(),
              },
            ]
          : [];
      });

      if (cards.length) {
        const { data, error } = await supabase.from("flashcards").insert(cards).select();
        if (!error && data) {
          setFlashcards((prev) => ({
            ...prev,
            [weekIndex]: [...(prev[weekIndex] || []), ...(data as Flashcard[])],
          }));
          alert(`${cards.length} kart yüklendi.`);
        }
      } else {
        alert("Kart bulunamadı. Format: ön_yüz,arka_yüz");
      }
    };

    reader.readAsText(file, "UTF-8");
    event.target.value = "";
  };

  const handleTestCSV = async (weekIndex: number, event: ChangeEvent<HTMLInputElement>) => {
    if (!activeCourseId) {
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      const text = String(loadEvent.target?.result ?? "");
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const firstLine = lines[0]?.toLowerCase() || "";
      const start = firstLine.includes("soru") || firstLine.includes("question") ? 1 : 0;

      const questions = lines.slice(start).flatMap((line) => {
        const parts = parseCSV(line);
        const parsedIndex = parseInt(parts[5] ?? "", 10);
        const correctIndex =
          !Number.isNaN(parsedIndex) && parsedIndex >= 0 && parsedIndex <= 3 ? parsedIndex : 0;

        return parts[0]?.trim() &&
          parts[1]?.trim() &&
          parts[2]?.trim() &&
          parts[3]?.trim() &&
          parts[4]?.trim()
          ? [
              {
                course_id: activeCourseId,
                week_index: weekIndex,
                question: parts[0].trim(),
                options: [
                  parts[1].trim(),
                  parts[2].trim(),
                  parts[3].trim(),
                  parts[4].trim(),
                ],
                correct_index: correctIndex,
              },
            ]
          : [];
      });

      if (questions.length) {
        const { data, error } = await supabase.from("test_questions").insert(questions).select();
        if (!error && data) {
          setTestQuestions((prev) => ({
            ...prev,
            [weekIndex]: [
              ...(prev[weekIndex] || []),
              ...(data as TestQuestion[]).map((item) => ({
                ...item,
                options: item.options as string[],
              })),
            ],
          }));
          alert(`${questions.length} soru yüklendi.`);
        }
      } else {
        alert("Soru bulunamadı. Format: soru,A,B,C,D,doğruIndex(0-3)");
      }
    };

    reader.readAsText(file, "UTF-8");
    event.target.value = "";
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) {
      return;
    }

    const userMessage = { role: "user", content: input };
    const newMessages = [...messages, userMessage];

    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setStats((prev) => ({ ...prev, messages: prev.messages + 1 }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          systemPrompt: activeCourse?.system_prompt ?? "",
          mode: chatMode,
          courseId: activeCourseId,
        }),
      });
      const data = (await response.json()) as { content?: string };
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content || "Bir hata oluştu." },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Bağlantı hatası oluştu." },
      ]);
    }

    setLoading(false);
  };

  const startFlashcardPlay = (weekIndex: number) => {
    const cards = [...(flashcards[weekIndex] || [])].sort(() => Math.random() - 0.5);
    setPlayMode({ weekIndex, cards, currentIndex: 0, flipped: false });
  };

  const startTestMode = (weekIndex: number) => {
    const questions = [...(testQuestions[weekIndex] || [])].sort(() => Math.random() - 0.5);
    setTestMode({
      weekIndex,
      questions,
      currentIndex: 0,
      selected: null,
      score: 0,
      done: false,
    });
  };

  const handleTestAnswer = (index: number) => {
    if (!testMode || testMode.selected !== null) {
      return;
    }

    const correct = testMode.questions[testMode.currentIndex].correct_index === index;
    setTestMode((prev) =>
      prev
        ? { ...prev, selected: index, score: correct ? prev.score + 1 : prev.score }
        : null,
    );
  };

  const nextTestQuestion = () => {
    if (!testMode) {
      return;
    }

    const next = testMode.currentIndex + 1;
    if (next >= testMode.questions.length) {
      void saveAssessmentResult(testMode.weekIndex, testMode.score, testMode.questions.length);
      setTestMode((prev) => (prev ? { ...prev, done: true } : null));
    } else {
      setTestMode((prev) => (prev ? { ...prev, currentIndex: next, selected: null } : null));
    }
  };

  if (dataLoading && courses.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#fff",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              border: "4px solid #e5e7eb",
              borderTopColor: "#2563eb",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <p style={{ color: "#6b7280" }}>Yükleniyor...</p>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#fff",
        fontFamily: "system-ui,sans-serif",
        color: "#1f2937",
        fontSize: 14,
      }}
    >
      {addCourseModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              width: "100%",
              maxWidth: 500,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <h3 style={{ fontWeight: 700, margin: 0, fontSize: 16 }}>Yeni Ders Ekle</h3>
              <button
                onClick={() => setAddCourseModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <X size={18} color="#6b7280" />
              </button>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 5,
                    color: "#374151",
                  }}
                >
                  Ders Adı *
                </label>
                <input
                  value={newCourse.name}
                  onChange={(event) =>
                    setNewCourse((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="ör. Medeni Hukuk"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 5,
                    color: "#374151",
                  }}
                >
                  Açıklama
                </label>
                <input
                  value={newCourse.description}
                  onChange={(event) =>
                    setNewCourse((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="Kısa ders açıklaması"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 5,
                    color: "#374151",
                  }}
                >
                  Hafta Sayısı
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={newCourse.weeks}
                  onChange={(event) =>
                    setNewCourse((prev) => ({
                      ...prev,
                      weeks: parseInt(event.target.value, 10) || 14,
                    }))
                  }
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    marginBottom: 5,
                    color: "#374151",
                  }}
                >
                  AI Asistan Yönergesi (Opsiyonel)
                </label>
                <textarea
                  value={newCourse.system_prompt}
                  onChange={(event) =>
                    setNewCourse((prev) => ({ ...prev, system_prompt: event.target.value }))
                  }
                  rows={3}
                  placeholder="Bu ders için AI asistanı nasıl davransın?"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 13,
                    resize: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <button
                onClick={handleAddCourse}
                style={{
                  padding: "11px 0",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Dersi Oluştur
              </button>
            </div>
          </div>
        </div>
      )}

      {editingOE && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              width: "100%",
              maxWidth: 480,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <h3 style={{ fontWeight: 700, margin: 0 }}>Soruyu Düzenle</h3>
              <button
                onClick={() => setEditingOE(null)}
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <X size={18} color="#6b7280" />
              </button>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
                  Soru
                </label>
                <textarea
                  value={editOEForm.question}
                  onChange={(event) =>
                    setEditOEForm((prev) => ({ ...prev, question: event.target.value }))
                  }
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 13,
                    resize: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
                  Model Cevap (Opsiyonel)
                </label>
                <textarea
                  value={editOEForm.answer}
                  onChange={(event) =>
                    setEditOEForm((prev) => ({ ...prev, answer: event.target.value }))
                  }
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 13,
                    resize: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={saveEditOE}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: "#7c3aed",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Kaydet
                </button>
                <button
                  onClick={() => setEditingOE(null)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: "#f3f4f6",
                    color: "#374151",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  İptal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingGoal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              width: "100%",
              maxWidth: 400,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <h3 style={{ fontWeight: 700, margin: 0 }}>Kısa Konu Adını Düzenle</h3>
              <button
                onClick={() => setEditingGoal(null)}
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <X size={18} color="#6b7280" />
              </button>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
                  Kısa Görünen Ad
                </label>
                <input
                  value={editGoalForm.label}
                  onChange={(event) =>
                    setEditGoalForm({ label: event.target.value })
                  }
                  placeholder="Örn. AİHM Başvuru"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
                  Asıl Konu Başlığı
                </label>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    fontSize: 12,
                    color: "#6b7280",
                    lineHeight: 1.5,
                  }}
                >
                  {editingGoal.topic_title}
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af", lineHeight: 1.4 }}>
                  Boş bırakırsan sağ panelde otomatik olarak asıl konu adı gösterilir.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={saveEditGoal}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Kaydet
                </button>
                <button
                  onClick={() => setEditingGoal(null)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: "#f3f4f6",
                    color: "#374151",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  İptal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {addModal.isOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              width: "100%",
              maxWidth: 480,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <h3 style={{ fontWeight: 600, margin: 0 }}>
                {addModal.type === "flashcard" && "Yeni Bilgi Kartı"}
                {addModal.type === "test" && "Yeni Test Sorusu"}
                {addModal.type === "openended" && "Yeni Açık Uçlu Soru"}
              </h3>
              <button
                onClick={() => setAddModal({ isOpen: false, type: null, weekIndex: 0 })}
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <X size={18} color="#6b7280" />
              </button>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              {addModal.type === "flashcard" && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                      Ön Yüz
                    </label>
                    <textarea
                      value={flashcardForm.front}
                      onChange={(event) =>
                        setFlashcardForm((prev) => ({ ...prev, front: event.target.value }))
                      }
                      rows={3}
                      placeholder="Soru veya kavram"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        fontSize: 13,
                        resize: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                      Arka Yüz
                    </label>
                    <textarea
                      value={flashcardForm.back}
                      onChange={(event) =>
                        setFlashcardForm((prev) => ({ ...prev, back: event.target.value }))
                      }
                      rows={3}
                      placeholder="Cevap"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        fontSize: 13,
                        resize: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <button
                    onClick={addFlashcard}
                    style={{
                      padding: "10px 0",
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Ekle
                  </button>
                </>
              )}

              {addModal.type === "test" && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                      Soru
                    </label>
                    <textarea
                      value={testForm.question}
                      onChange={(event) =>
                        setTestForm((prev) => ({ ...prev, question: event.target.value }))
                      }
                      rows={2}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        fontSize: 13,
                        resize: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  {testForm.options.map((option, index) => (
                    <div key={index} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="radio"
                        name="correct"
                        checked={testForm.correctIndex === index}
                        onChange={() =>
                          setTestForm((prev) => ({ ...prev, correctIndex: index }))
                        }
                      />
                      <input
                        value={option}
                        onChange={(event) => {
                          const options = [...testForm.options];
                          options[index] = event.target.value;
                          setTestForm((prev) => ({ ...prev, options }));
                        }}
                        placeholder={`Seçenek ${String.fromCharCode(65 + index)}`}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          border: "1px solid #d1d5db",
                          borderRadius: 6,
                          fontSize: 13,
                        }}
                      />
                    </div>
                  ))}
                  <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>
                    Doğru cevap için daireye tıkla
                  </p>
                  <button
                    onClick={addTestQuestion}
                    style={{
                      padding: "10px 0",
                      background: "#059669",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Ekle
                  </button>
                </>
              )}

              {addModal.type === "openended" && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                      Soru
                    </label>
                    <textarea
                      value={openEndedForm.question}
                      onChange={(event) =>
                        setOpenEndedForm((prev) => ({ ...prev, question: event.target.value }))
                      }
                      rows={3}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        fontSize: 13,
                        resize: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                      Model Cevap (Opsiyonel)
                    </label>
                    <textarea
                      value={openEndedForm.answer}
                      onChange={(event) =>
                        setOpenEndedForm((prev) => ({ ...prev, answer: event.target.value }))
                      }
                      rows={4}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        fontSize: 13,
                        resize: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <button
                    onClick={addOpenEnded}
                    style={{
                      padding: "10px 0",
                      background: "#7c3aed",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Ekle
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {previewModal.isOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
              width: "100%",
              maxWidth: 900,
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 20px",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {previewModal.type === "audio" ? (
                  <Headphones size={18} color="#2563eb" />
                ) : previewModal.type === "infographic" ? (
                  <ImageIcon size={18} color="#ea580c" />
                ) : (
                  <FileText size={18} color="#2563eb" />
                )}
                <div>
                  <div style={{ fontWeight: 600 }}>{previewModal.name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>
                    Hafta {previewModal.weekIndex + 1}
                  </div>
                </div>
              </div>
              <button
                onClick={() =>
                  setPreviewModal({ isOpen: false, type: null, url: "", name: "", weekIndex: 0 })
                }
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <X size={18} color="#6b7280" />
              </button>
            </div>
            <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
              {previewModal.type === "audio" ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "48px 0",
                  }}
                >
                  <div
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: "50%",
                      background: "#dbeafe",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 24,
                    }}
                  >
                    <Headphones size={48} color="#2563eb" />
                  </div>
                  <audio controls src={previewModal.url} autoPlay style={{ width: "100%", maxWidth: 400 }} />
                </div>
              ) : previewModal.type === "infographic" ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "65vh",
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <img
                    src={previewModal.url}
                    alt={previewModal.name}
                    style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }}
                  />
                </div>
              ) : (
                <iframe
                  src={previewModal.url}
                  style={{
                    width: "100%",
                    height: "65vh",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                  }}
                  title={previewModal.name}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {playMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, padding: 32 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <span style={{ fontWeight: 600 }}>
                Bilgi Kartları - Hafta {playMode.weekIndex + 1}
              </span>
              <button
                onClick={() => setPlayMode(null)}
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 16, textAlign: "center" }}>
              {playMode.currentIndex + 1} / {playMode.cards.length}
            </div>
            <div
              onClick={() =>
                setPlayMode((prev) => (prev ? { ...prev, flipped: !prev.flipped } : null))
              }
              style={{
                minHeight: 180,
                background: playMode.flipped ? "#ecfdf5" : "#eff6ff",
                borderRadius: 12,
                border: `2px solid ${playMode.flipped ? "#6ee7b7" : "#bfdbfe"}`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: playMode.flipped ? "#059669" : "#2563eb",
                  marginBottom: 12,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {playMode.flipped ? "Arka Yüz - Cevap" : "Ön Yüz - Soru"}
              </div>
              <p style={{ textAlign: "center", fontSize: 15, fontWeight: 500, color: "#1f2937", margin: 0 }}>
                {playMode.flipped
                  ? playMode.cards[playMode.currentIndex].back
                  : playMode.cards[playMode.currentIndex].front}
              </p>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 16 }}>Çevirmek için tıkla</div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 20 }}>
              <button
                onClick={() =>
                  setPlayMode((prev) =>
                    prev
                      ? { ...prev, currentIndex: Math.max(0, prev.currentIndex - 1), flipped: false }
                      : null,
                  )
                }
                disabled={playMode.currentIndex === 0}
                style={{
                  padding: "8px 20px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  background: "#fff",
                  cursor: playMode.currentIndex === 0 ? "not-allowed" : "pointer",
                  opacity: playMode.currentIndex === 0 ? 0.4 : 1,
                }}
              >
                Önceki
              </button>
              <button
                onClick={() =>
                  setPlayMode((prev) =>
                    prev
                      ? {
                          ...prev,
                          flipped: false,
                          cards: [...prev.cards].sort(() => Math.random() - 0.5),
                          currentIndex: 0,
                        }
                      : null,
                  )
                }
                style={{
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <Shuffle size={16} />
              </button>
              {playMode.currentIndex < playMode.cards.length - 1 ? (
                <button
                  onClick={() =>
                    setPlayMode((prev) =>
                      prev ? { ...prev, currentIndex: prev.currentIndex + 1, flipped: false } : null,
                    )
                  }
                  style={{
                    padding: "8px 20px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Sonraki
                </button>
              ) : (
                <button
                  onClick={() => setPlayMode(null)}
                  style={{
                    padding: "8px 20px",
                    background: "#059669",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Tamamla
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {testMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 580, padding: 32 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <span style={{ fontWeight: 600 }}>Test - Hafta {testMode.weekIndex + 1}</span>
              <button
                onClick={() => setTestMode(null)}
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>
            {testMode.done ? (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>
                  {testMode.score >= testMode.questions.length * 0.7 ? "Başarılı" : "Tekrar"}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                  {testMode.score} / {testMode.questions.length}
                </div>
                <div style={{ color: "#6b7280", marginBottom: 24 }}>
                  {testMode.score >= testMode.questions.length * 0.7
                    ? "Harika! Konuya hâkimsin."
                    : "Biraz daha çalışman gerekiyor."}
                </div>
                <button
                  onClick={() => setTestMode(null)}
                  style={{
                    padding: "10px 28px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Kapat
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
                  Soru {testMode.currentIndex + 1} / {testMode.questions.length}
                </div>
                <div
                  style={{
                    background: "#f9fafb",
                    borderRadius: 10,
                    padding: 16,
                    marginBottom: 16,
                    fontWeight: 500,
                  }}
                >
                  {testMode.questions[testMode.currentIndex].question}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {testMode.questions[testMode.currentIndex].options.map((option, index) => {
                    const correctIndex = testMode.questions[testMode.currentIndex].correct_index;
                    let bg = "#fff";
                    let border = "1px solid #d1d5db";
                    let color = "#1f2937";

                    if (testMode.selected !== null) {
                      if (index === correctIndex) {
                        bg = "#ecfdf5";
                        border = "2px solid #059669";
                        color = "#065f46";
                      } else if (index === testMode.selected && index !== correctIndex) {
                        bg = "#fef2f2";
                        border = "2px solid #ef4444";
                        color = "#991b1b";
                      }
                    }

                    return (
                      <button
                        key={index}
                        onClick={() => handleTestAnswer(index)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 14px",
                          background: bg,
                          border,
                          borderRadius: 8,
                          cursor: testMode.selected !== null ? "default" : "pointer",
                          color,
                          textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background:
                              index === correctIndex && testMode.selected !== null ? "#059669" : "#e5e7eb",
                            color: index === correctIndex && testMode.selected !== null ? "#fff" : "#374151",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            fontSize: 12,
                            flexShrink: 0,
                          }}
                        >
                          {String.fromCharCode(65 + index)}
                        </span>
                        {option}
                      </button>
                    );
                  })}
                </div>
                {testMode.selected !== null && (
                  <button
                    onClick={nextTestQuestion}
                    style={{
                      marginTop: 16,
                      width: "100%",
                      padding: "10px 0",
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {testMode.currentIndex < testMode.questions.length - 1
                      ? "Sonraki Soru"
                      : "Sonuçları Gör"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          borderBottom: "1px solid #f3f4f6",
          background: "#fff",
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", fontWeight: 800, fontSize: 17, letterSpacing: "-0.5px", color: "#1e40af" }}>
            <BookMarked size={18} style={{ marginRight: 7, color: "#2563eb" }} />
            Ustad<span style={{ color: "#2563eb" }}>.ai</span>
          </div>

          <div style={{ position: "relative" }}>
            {/* 1. Görünmez Katman: Menü açıldığında ekranı kaplar ama butonun ve menünün ALTINDA kalır */}
            {courseDropOpen && (
              <div
                onClick={() => setCourseDropOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 40 }}
              />
            )}

            {/* 2. Asıl "Ders Seç" Butonu */}
            <button
              onClick={() => setCourseDropOpen((open) => !open)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 13px",
                border: "1px solid #e5e7eb",
                borderRadius: 9,
                fontSize: 13,
                background: "#fff",
                cursor: "pointer",
                fontWeight: 500,
                color: "#374151",
                minWidth: 180,
                position: "relative",
                zIndex: 45, // Görünmez katmanın (40) üstünde kalsın ki tıklanabilsin
              }}
            >
              <BookOpen size={14} color="#6b7280" />
              <span
                style={{
                  flex: 1,
                  textAlign: "left",
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {activeCourse?.name ?? "Ders seç"}
              </span>
              <ChevronDown
                size={13}
                color="#9ca3af"
                style={{
                  transform: courseDropOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s",
                }}
              />
            </button>

            {/* 3. Açılır Menünün Kendisi */}
            {courseDropOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  minWidth: 260,
                  zIndex: 50, // En üstte (50) bu olacak, böylece tıklamaları hiçbir şey engelleyemez
                }}
              >
                <div style={{ padding: "8px 0" }}>
                  {courses.map((course) => (
                    <div key={course.id} style={{ display: "flex", alignItems: "center", gap: 0 }}>
                      <button
                        onClick={() => {
                          setActiveCourseId(course.id);
                          setCourseDropOpen(false);
                          setActiveTab("curriculum");
                        }}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "9px 14px",
                          background: course.id === activeCourseId ? "#eff6ff" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 7,
                            background: course.id === activeCourseId ? "#dbeafe" : "#f3f4f6",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <BookOpen size={13} color={course.id === activeCourseId ? "#2563eb" : "#9ca3af"} />
                        </div>
                        <div>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: 13,
                              color: course.id === activeCourseId ? "#1d4ed8" : "#1f2937",
                            }}
                          >
                            {course.name}
                          </div>
                          {course.description && (
                            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                              {course.description}
                            </div>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={() => handleDeleteCourse(course.id)}
                        style={{ padding: "9px 10px", background: "transparent", border: "none", cursor: "pointer" }}
                      >
                        <Trash2 size={13} color="#d1d5db" />
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: "1px solid #f3f4f6", padding: "6px 0" }}>
                  <button
                    onClick={() => {
                      setCourseDropOpen(false);
                      setAddCourseModal(true);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "9px 14px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "#2563eb",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <PlusCircle size={14} /> Yeni Ders Ekle
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", background: "#f3f4f6", padding: 4, borderRadius: 10, gap: 2 }}>
          {(
            [
              ["curriculum", "Müfredat", LayoutList],
              ["exam", "İmtihan", GraduationCap],
              ["chat", "Sohbet", MessageSquare],
            ] as [string, string, ElementType][]
          ).map(([tab, label, Icon]) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab === "exam") {
                  setExamView(null);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 14px",
                borderRadius: 8,
                border: "none",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
                background: activeTab === tab ? "#fff" : "transparent",
                color: activeTab === tab ? "#2563eb" : "#6b7280",
                boxShadow: activeTab === tab ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s",
              }}
            >
              <Icon size={14} style={{ marginRight: 6 }} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", background: "#f9fafb" }}>
          {!activeCourse && !dataLoading && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 16,
                color: "#6b7280",
              }}
            >
              <BookMarked size={48} color="#d1d5db" />
              <p style={{ fontWeight: 600, fontSize: 16, color: "#374151" }}>Henüz ders eklenmemiş</p>
              <button
                onClick={() => setAddCourseModal(true)}
                style={{
                  padding: "10px 24px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                İlk Dersi Ekle
              </button>
            </div>
          )}

          {dataLoading && activeCourse && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  border: "3px solid #e5e7eb",
                  borderTopColor: "#2563eb",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
            </div>
          )}

          {activeTab === "curriculum" && activeCourse && !dataLoading && (
            <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>
                  {activeCourse.name} - Müfredat
                </h2>
                <p style={{ color: "#6b7280", margin: 0 }}>
                  {weekCount} haftalık ders planı. Başlıkları düzenleyebilir, not, ses ve PNG
                  infografik yükleyebilirsin.
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {Array.from({ length: weekCount }, (_, index) => {
                  const topic = getWeekTitle(index);
                  const isExam = topic.includes("Final") || topic.includes("Vize");
                  const isEditing = editingWeek === index;

                  return (
                    <div
                      key={index}
                      style={{
                        background: isExam ? "#fffbeb" : "#fff",
                        border: `1px solid ${isExam ? "#fde68a" : "#e5e7eb"}`,
                        borderRadius: 12,
                        padding: "20px 24px",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <span
                          style={{
                            padding: "6px 14px",
                            borderRadius: 20,
                            fontSize: 13,
                            fontWeight: 600,
                            background: isExam ? "#fef3c7" : "#dbeafe",
                            color: isExam ? "#92400e" : "#1d4ed8",
                            flexShrink: 0,
                          }}
                        >
                          Hafta {index + 1}
                        </span>
                        {isEditing ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                            <input
                              value={editTitle}
                              onChange={(event) => setEditTitle(event.target.value)}
                              style={{
                                flex: 1,
                                padding: "6px 10px",
                                border: "1px solid #2563eb",
                                borderRadius: 6,
                                fontSize: 13,
                              }}
                              autoFocus
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void updateWeekTitle(index, editTitle);
                                }
                                if (event.key === "Escape") {
                                  setEditingWeek(null);
                                }
                              }}
                            />
                            <button
                              onClick={() => updateWeekTitle(index, editTitle)}
                              style={{
                                padding: "6px 10px",
                                background: "#2563eb",
                                color: "#fff",
                                border: "none",
                                borderRadius: 6,
                                cursor: "pointer",
                              }}
                            >
                              <Save size={14} />
                            </button>
                            <button
                              onClick={() => setEditingWeek(null)}
                              style={{
                                padding: "6px 10px",
                                background: "#f3f4f6",
                                border: "none",
                                borderRadius: 6,
                                cursor: "pointer",
                              }}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span
                              style={{
                                fontWeight: 500,
                                color: "#1f2937",
                                flex: 1,
                                fontSize: 15,
                                lineHeight: 1.5,
                              }}
                            >
                              {topic}
                            </span>
                            <button
                              onClick={() => {
                                setEditingWeek(index);
                                setEditTitle(topic);
                              }}
                              style={{
                                padding: "4px 8px",
                                background: "#f3f4f6",
                                border: "none",
                                borderRadius: 6,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 11,
                                color: "#6b7280",
                              }}
                            >
                              <Edit2 size={12} /> Düzenle
                            </button>
                          </>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                        {materials[index]?.audio ? (
                          <div style={{ position: "relative" }}>
                            <button
                              onClick={() =>
                                setPreviewModal({
                                  isOpen: true,
                                  type: "audio",
                                  url: materials[index].audio?.file_url ?? "",
                                  name: materials[index].audio?.file_name ?? "",
                                  weekIndex: index,
                                })
                              }
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 100,
                                height: 72,
                                border: "1px solid #6ee7b7",
                                borderRadius: 10,
                                background: "#ecfdf5",
                                cursor: "pointer",
                              }}
                            >
                              <Play size={20} color="#059669" />
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "#065f46",
                                  marginTop: 4,
                                  maxWidth: 90,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {materials[index].audio?.file_name}
                              </span>
                            </button>
                            <button
                              onClick={() => handleDeleteFile(index, "audio")}
                              style={{
                                position: "absolute",
                                top: -6,
                                right: -6,
                                background: "#ef4444",
                                border: "none",
                                borderRadius: "50%",
                                width: 18,
                                height: 18,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              <Trash2 size={10} color="#fff" />
                            </button>
                          </div>
                        ) : (
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 100,
                              height: 72,
                              border: "1px dashed #d1d5db",
                              borderRadius: 10,
                              background: "#f9fafb",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="file"
                              accept="audio/*"
                              style={{ display: "none" }}
                              onChange={(event) => handleFileUpload(index, "audio", event)}
                            />
                            <Headphones size={20} color="#9ca3af" />
                            <span style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                              Ses Yükle
                            </span>
                          </label>
                        )}
                        {materials[index]?.pdf ? (
                          <div style={{ position: "relative" }}>
                            <button
                              onClick={() =>
                                setPreviewModal({
                                  isOpen: true,
                                  type: "pdf",
                                  url: materials[index].pdf?.file_url ?? "",
                                  name: materials[index].pdf?.file_name ?? "",
                                  weekIndex: index,
                                })
                              }
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 100,
                                height: 72,
                                border: "1px solid #6ee7b7",
                                borderRadius: 10,
                                background: "#ecfdf5",
                                cursor: "pointer",
                              }}
                            >
                              <Eye size={20} color="#059669" />
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "#065f46",
                                  marginTop: 4,
                                  maxWidth: 90,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {materials[index].pdf?.file_name}
                              </span>
                            </button>
                            <button
                              onClick={() => handleDeleteFile(index, "pdf")}
                              style={{
                                position: "absolute",
                                top: -6,
                                right: -6,
                                background: "#ef4444",
                                border: "none",
                                borderRadius: "50%",
                                width: 18,
                                height: 18,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              <Trash2 size={10} color="#fff" />
                            </button>
                          </div>
                        ) : (
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 100,
                              height: 72,
                              border: "1px dashed #d1d5db",
                              borderRadius: 10,
                              background: "#f9fafb",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="file"
                              accept=".pdf"
                              style={{ display: "none" }}
                              onChange={(event) => handleFileUpload(index, "pdf", event)}
                            />
                            <FileText size={20} color="#9ca3af" />
                            <span style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                              PDF Yükle
                            </span>
                          </label>
                        )}
                        {materials[index]?.infographic ? (
                          <div style={{ position: "relative" }}>
                            <button
                              onClick={() =>
                                setPreviewModal({
                                  isOpen: true,
                                  type: "infographic",
                                  url: materials[index].infographic?.file_url ?? "",
                                  name: materials[index].infographic?.file_name ?? "",
                                  weekIndex: index,
                                })
                              }
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 100,
                                height: 72,
                                border: "1px solid #fdba74",
                                borderRadius: 10,
                                background: "#fff7ed",
                                cursor: "pointer",
                              }}
                            >
                              <ImageIcon size={20} color="#ea580c" />
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "#9a3412",
                                  marginTop: 4,
                                  maxWidth: 90,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {materials[index].infographic?.file_name}
                              </span>
                            </button>
                            <button
                              onClick={() => handleDeleteFile(index, "infographic")}
                              style={{
                                position: "absolute",
                                top: -6,
                                right: -6,
                                background: "#ef4444",
                                border: "none",
                                borderRadius: "50%",
                                width: 18,
                                height: 18,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              <Trash2 size={10} color="#fff" />
                            </button>
                          </div>
                        ) : (
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 100,
                              height: 72,
                              border: "1px dashed #fdba74",
                              borderRadius: 10,
                              background: "#fff7ed",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="file"
                              accept=".png,image/png"
                              style={{ display: "none" }}
                              onChange={(event) => handleFileUpload(index, "infographic", event)}
                            />
                            <ImageIcon size={20} color="#f97316" />
                            <span style={{ fontSize: 11, color: "#c2410c", marginTop: 4 }}>
                              İnfografik Yükle
                            </span>
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "exam" && !examView && activeCourse && !dataLoading && (
            <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
              <div style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>
                  {activeCourse.name} - İmtihan
                </h2>
                <p style={{ color: "#6b7280", margin: 0 }}>
                  Her hafta için bilgi kartları, test ve açık uçlu sorularla pekiştir.
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {Array.from({ length: weekCount }, (_, index) => {
                  const topic = getWeekTitle(index);
                  const isExpanded = expandedExamWeek === index;

                  return (
                    <div
                      key={index}
                      style={{
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        overflow: "hidden",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}
                    >
                      <button
                        onClick={() => setExpandedExamWeek(isExpanded ? null : index)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "14px 18px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                          <span
                            style={{
                              padding: "6px 14px",
                              borderRadius: 20,
                              fontSize: 13,
                              fontWeight: 600,
                              background: "#dbeafe",
                              color: "#1d4ed8",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Hafta {index + 1}
                          </span>
                          <span style={{ fontWeight: 500, fontSize: 15, color: "#1f2937" }}>
                            {topic}
                          </span>
                        </div>
                        <ChevronRight
                          size={16}
                          color="#9ca3af"
                          style={{
                            transform: isExpanded ? "rotate(90deg)" : "none",
                            transition: "transform 0.2s",
                          }}
                        />
                      </button>
                      {isExpanded && (
                        <div
                          style={{
                            borderTop: "1px solid #f3f4f6",
                            padding: 16,
                            background: "#fafafa",
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr",
                            gap: 10,
                          }}
                        >
                          {(
                            [
                              [
                                "flashcards",
                                "Bilgi Kartları",
                                "Flashcards",
                                Layers,
                                "#2563eb",
                                "#dbeafe",
                                "#eff6ff",
                              ],
                              [
                                "test",
                                "Test Soruları",
                                "Çoktan Seçmeli",
                                ClipboardList,
                                "#059669",
                                "#d1fae5",
                                "#ecfdf5",
                              ],
                              [
                                "openended",
                                "Açık Uçlu",
                                "Klasik Sorular",
                                PenLine,
                                "#7c3aed",
                                "#ede9fe",
                                "#f5f3ff",
                              ],
                            ] as [string, string, string, ElementType, string, string, string][]
                          ).map(([type, label, subLabel, Icon, color, iconBg, cardBg]) => (
                            <button
                              key={type}
                              onClick={() => setExamView({ weekIndex: index, type })}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 8,
                                padding: 16,
                                background: cardBg,
                                border: `1px solid ${iconBg}`,
                                borderRadius: 10,
                                cursor: "pointer",
                              }}
                            >
                              <div
                                style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: "50%",
                                  background: iconBg,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Icon size={18} color={color} />
                              </div>
                              <span style={{ fontWeight: 600, fontSize: 13, color: "#1f2937" }}>
                                {label}
                              </span>
                              <span style={{ fontSize: 11, color: "#6b7280" }}>{subLabel}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "exam" && examView && activeCourse && (
            <div style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
              <button
                onClick={() => setExamView(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#6b7280",
                  fontSize: 13,
                  marginBottom: 24,
                }}
              >
                <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} /> Geri Dön
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    background: "#fef3c7",
                    color: "#92400e",
                  }}
                >
                  Hafta {examView.weekIndex + 1}
                </span>
                {examView.type === "flashcards" && (
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      background: "#dbeafe",
                      color: "#1d4ed8",
                    }}
                  >
                    Bilgi Kartları
                  </span>
                )}
                {examView.type === "test" && (
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      background: "#d1fae5",
                      color: "#065f46",
                    }}
                  >
                    Test Soruları
                  </span>
                )}
                {examView.type === "openended" && (
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      background: "#ede9fe",
                      color: "#5b21b6",
                    }}
                  >
                    Açık Uçlu Sorular
                  </span>
                )}
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24, color: "#1f2937" }}>
                {getWeekTitle(examView.weekIndex)}
              </h2>

              {examView.type === "flashcards" && (
                <div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                    <button
                      onClick={() =>
                        setAddModal({ isOpen: true, type: "flashcard", weekIndex: examView.weekIndex })
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 16px",
                        background: "#2563eb",
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontWeight: 500,
                      }}
                    >
                      <Plus size={14} /> Yeni Kart
                    </button>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 16px",
                        background: "#fff",
                        color: "#2563eb",
                        border: "1px solid #bfdbfe",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontWeight: 500,
                      }}
                    >
                      <Upload size={14} /> CSV
                      <input
                        type="file"
                        accept=".csv"
                        style={{ display: "none" }}
                        onChange={(event) => handleFlashcardCSV(examView.weekIndex, event)}
                      />
                    </label>
                    {flashcards[examView.weekIndex]?.length > 0 && (
                      <button
                        onClick={() => startFlashcardPlay(examView.weekIndex)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "8px 16px",
                          background: "#059669",
                          color: "#fff",
                          border: "none",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontWeight: 500,
                        }}
                      >
                        <Play size={14} /> Çalış
                      </button>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 16 }}>
                    CSV: ön_yüz,arka_yüz
                  </p>
                  {!flashcards[examView.weekIndex]?.length ? (
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 32,
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: "50%",
                          background: "#dbeafe",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto 12px",
                        }}
                      >
                        <Layers size={24} color="#2563eb" />
                      </div>
                      <h3 style={{ fontWeight: 600, marginBottom: 4 }}>Henüz Kart Yok</h3>
                      <p style={{ color: "#6b7280", fontSize: 13 }}>
                        Bu hafta için bilgi kartı eklenmemiş.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      {flashcards[examView.weekIndex].map((card) => (
                        <div
                          key={card.id}
                          style={{
                            background: "#fff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 12,
                            padding: 16,
                            position: "relative",
                          }}
                        >
                          <button
                            onClick={() => deleteFlashcard(examView.weekIndex, card.id)}
                            style={{
                              position: "absolute",
                              top: 10,
                              right: 10,
                              background: "#fee2e2",
                              border: "none",
                              borderRadius: 6,
                              padding: "4px 6px",
                              cursor: "pointer",
                            }}
                          >
                            <Trash2 size={13} color="#ef4444" />
                          </button>
                          <div style={{ marginBottom: 10 }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                background: "#dbeafe",
                                color: "#1d4ed8",
                                padding: "2px 8px",
                                borderRadius: 4,
                              }}
                            >
                              Ön Yüz
                            </span>
                            <p style={{ margin: "8px 0 0", color: "#1f2937" }}>{card.front}</p>
                          </div>
                          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10 }}>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                background: "#d1fae5",
                                color: "#065f46",
                                padding: "2px 8px",
                                borderRadius: 4,
                              }}
                            >
                              Arka Yüz
                            </span>
                            <p style={{ margin: "8px 0 0", color: "#374151" }}>{card.back}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {examView.type === "test" && (
                <div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                    <button
                      onClick={() => setAddModal({ isOpen: true, type: "test", weekIndex: examView.weekIndex })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 16px",
                        background: "#059669",
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontWeight: 500,
                      }}
                    >
                      <Plus size={14} /> Yeni Soru
                    </button>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 16px",
                        background: "#fff",
                        color: "#059669",
                        border: "1px solid #6ee7b7",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontWeight: 500,
                      }}
                    >
                      <Upload size={14} /> CSV
                      <input
                        type="file"
                        accept=".csv"
                        style={{ display: "none" }}
                        onChange={(event) => handleTestCSV(examView.weekIndex, event)}
                      />
                    </label>
                    {testQuestions[examView.weekIndex]?.length > 0 && (
                      <button
                        onClick={() => startTestMode(examView.weekIndex)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "8px 16px",
                          background: "#2563eb",
                          color: "#fff",
                          border: "none",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontWeight: 500,
                        }}
                      >
                        <Play size={14} /> Testi Başlat
                      </button>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 16 }}>
                    CSV: soru,A,B,C,D,doğruIndex(0-3)
                  </p>
                  {!testQuestions[examView.weekIndex]?.length ? (
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 32,
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: "50%",
                          background: "#d1fae5",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto 12px",
                        }}
                      >
                        <ClipboardList size={24} color="#059669" />
                      </div>
                      <h3 style={{ fontWeight: 600, marginBottom: 4 }}>Henüz Soru Yok</h3>
                      <p style={{ color: "#6b7280", fontSize: 13 }}>
                        Bu hafta için test sorusu eklenmemiş.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {testQuestions[examView.weekIndex].map((question, index) => (
                        <div
                          key={question.id}
                          style={{
                            background: "#fff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 12,
                            padding: 16,
                            position: "relative",
                          }}
                        >
                          <button
                            onClick={() => deleteTestQuestion(examView.weekIndex, question.id)}
                            style={{
                              position: "absolute",
                              top: 10,
                              right: 10,
                              background: "#fee2e2",
                              border: "none",
                              borderRadius: 6,
                              padding: "4px 6px",
                              cursor: "pointer",
                            }}
                          >
                            <Trash2 size={13} color="#ef4444" />
                          </button>
                          <p style={{ fontWeight: 600, marginBottom: 10 }}>
                            {index + 1}. {question.question}
                          </p>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {question.options.map((option, optionIndex) => (
                              <div
                                key={optionIndex}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "8px 12px",
                                  borderRadius: 8,
                                  background:
                                    optionIndex === question.correct_index ? "#ecfdf5" : "#f9fafb",
                                  border: `1px solid ${
                                    optionIndex === question.correct_index ? "#6ee7b7" : "#e5e7eb"
                                  }`,
                                }}
                              >
                                <span
                                  style={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: "50%",
                                    background:
                                      optionIndex === question.correct_index ? "#059669" : "#e5e7eb",
                                    color:
                                      optionIndex === question.correct_index ? "#fff" : "#374151",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontWeight: 700,
                                    fontSize: 11,
                                    flexShrink: 0,
                                  }}
                                >
                                  {String.fromCharCode(65 + optionIndex)}
                                </span>
                                <span
                                  style={{
                                    color:
                                      optionIndex === question.correct_index ? "#065f46" : "#374151",
                                    fontSize: 13,
                                  }}
                                >
                                  {option}
                                </span>
                                {optionIndex === question.correct_index && (
                                  <CheckCircle size={14} color="#059669" style={{ marginLeft: "auto" }} />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {examView.type === "openended" && (
                <div>
                  <button
                    onClick={() =>
                      setAddModal({ isOpen: true, type: "openended", weekIndex: examView.weekIndex })
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 16px",
                      background: "#7c3aed",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 500,
                      marginBottom: 16,
                    }}
                  >
                    <Plus size={14} /> Yeni Soru
                  </button>
                  {!openEndedQuestions[examView.weekIndex]?.length ? (
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 32,
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: "50%",
                          background: "#ede9fe",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto 12px",
                        }}
                      >
                        <PenLine size={24} color="#7c3aed" />
                      </div>
                      <h3 style={{ fontWeight: 600, marginBottom: 4 }}>Henüz Soru Yok</h3>
                      <p style={{ color: "#6b7280", fontSize: 13 }}>
                        Bu hafta için açık uçlu soru eklenmemiş.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {openEndedQuestions[examView.weekIndex].map((question, index) => (
                        <div
                          key={question.id}
                          style={{
                            background: "#fff",
                            border: "1px solid #e5e7eb",
                            borderRadius: 12,
                            padding: 16,
                            position: "relative",
                          }}
                        >
                          <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
                            <button
                              onClick={() => startEditOE(question)}
                              style={{
                                background: "#ede9fe",
                                border: "none",
                                borderRadius: 6,
                                padding: "4px 6px",
                                cursor: "pointer",
                              }}
                            >
                              <Edit2 size={13} color="#7c3aed" />
                            </button>
                            <button
                              onClick={() => deleteOpenEnded(examView.weekIndex, question.id)}
                              style={{
                                background: "#fee2e2",
                                border: "none",
                                borderRadius: 6,
                                padding: "4px 6px",
                                cursor: "pointer",
                              }}
                            >
                              <Trash2 size={13} color="#ef4444" />
                            </button>
                          </div>
                          <p style={{ fontWeight: 600, marginBottom: 8, paddingRight: 60 }}>
                            {index + 1}. {question.question}
                          </p>
                          {question.answer && (
                            <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 10 }}>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  background: "#ede9fe",
                                  color: "#5b21b6",
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                }}
                              >
                                Model Cevap
                              </span>
                              <p style={{ margin: "8px 0 0", color: "#374151", fontSize: 13 }}>
                                {question.answer}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "chat" && activeCourse && (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div
                style={{
                  padding: "18px 32px 0",
                  background: "#f9fafb",
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    background: "#eef2f7",
                    padding: 4,
                    borderRadius: 12,
                    gap: 4,
                    flexWrap: "wrap",
                  }}
                >
                  {(
                    [
                      ["general", "Genel AI", "Serbest sohbet ve genel yardım"],
                      ["materials", "Ders Materyalleri", "Sadece yüklenen ders materyallerine göre yanıt"],
                    ] as [ChatMode, string, string][]
                  ).map(([mode, label, description]) => (
                    <button
                      key={mode}
                      onClick={() => {
                        if (chatMode === mode) {
                          return;
                        }
                        setChatMode(mode);
                        setMessages([]);
                        setInput("");
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 2,
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "none",
                        background: chatMode === mode ? "#fff" : "transparent",
                        boxShadow: chatMode === mode ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                        cursor: "pointer",
                        minWidth: 200,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: chatMode === mode ? "#2563eb" : "#374151",
                        }}
                      >
                        {label}
                      </span>
                      <span style={{ fontSize: 11, color: "#6b7280", textAlign: "left" }}>
                        {description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "24px 32px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {messages.length === 0 && (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "center",
                      padding: 48,
                      color: "#6b7280",
                    }}
                  >
                    <div style={{ fontSize: 40, marginBottom: 16 }}>Ders</div>
                    <h2 style={{ fontSize: 18, fontWeight: 600, color: "#1f2937", marginBottom: 8 }}>
                      {chatMode === "general"
                        ? `${activeCourse.name} - Genel AI`
                        : `${activeCourse.name} - Materyal Asistanı`}
                    </h2>
                    <p style={{ fontSize: 13, maxWidth: 420, lineHeight: 1.6 }}>
                      {chatMode === "general"
                        ? "Genel sorular sorabilir, kavram açıklatabilir ve serbest biçimde yapay zeka ile sohbet edebilirsin."
                        : "Bu mod yalnızca müfredat bölümüne yüklediğin ders materyallerine dayanarak yanıt verir. Materyaller dışında bilgi uydurmaz."}
                    </p>
                  </div>
                )}
                {messages.map((message, index) => (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      justifyContent: message.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "75%",
                        padding: "12px 16px",
                        borderRadius:
                          message.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                        background: message.role === "user" ? "#2563eb" : "#fff",
                        color: message.role === "user" ? "#fff" : "#1f2937",
                        border: message.role === "assistant" ? "1px solid #e5e7eb" : "none",
                        fontSize: 14,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div style={{ display: "flex" }}>
                    <div
                      style={{
                        padding: "12px 16px",
                        borderRadius: "18px 18px 18px 4px",
                        background: "#fff",
                        border: "1px solid #e5e7eb",
                        display: "flex",
                        gap: 4,
                      }}
                    >
                      {[0, 1, 2].map((index) => (
                        <div
                          key={index}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#9ca3af",
                            animation: `bounce 1s ${index * 0.2}s infinite`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div style={{ padding: "16px 32px", background: "#fff", borderTop: "1px solid #f3f4f6" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: "8px 8px 8px 16px",
                    background: "#fff",
                  }}
                >
                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder={
                      chatMode === "general"
                        ? "Genel bir soru sor..."
                        : `${activeCourse.name} materyallerine göre soru sor...`
                    }
                    style={{
                      flex: 1,
                      border: "none",
                      outline: "none",
                      fontSize: 14,
                      background: "transparent",
                    }}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    style={{
                      padding: "8px 12px",
                      background: loading || !input.trim() ? "#93c5fd" : "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            width: 280,
            borderLeft: "1px solid #f3f4f6",
            background: "#fff",
            overflowY: "auto",
            padding: 20,
            flexShrink: 0,
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", fontWeight: 600, marginBottom: 14, color: "#1f2937" }}>
              <Activity size={15} style={{ marginRight: 8, color: "#6b7280" }} /> Aktivite
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 13 }}>
              <span style={{ color: "#6b7280" }}>Mesajlar:</span>
              <span style={{ fontWeight: 600, color: "#1f2937" }}>{stats.messages}</span>
            </div>
          </div>

          <hr style={{ border: "none", borderTop: "1px solid #f3f4f6", margin: "0 0 24px" }} />

          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", fontWeight: 600, marginBottom: 8, color: "#1f2937" }}>
              <Target size={15} style={{ marginRight: 8, color: "#6b7280" }} />
              Ölçme-Değerlendirme
            </div>
            <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5, margin: "0 0 14px" }}>
              Her haftanın başarı yüzdesi, imtihan bölümündeki test sorularına verdiğin doğru
              cevap oranına göre güncellenir.
            </p>

            {learningGoals.length === 0 && (
              <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 8 }}>
                Konu değerlendirmeleri hazırlanıyor.
              </p>
            )}

            {learningGoals.map((goal) => {
              const availableQuestions = testQuestions[goal.week_index]?.length ?? 0;
              const hasResult = goal.total_questions > 0;
              const assessmentVisual = getAssessmentVisual(
                goal.progress,
                goal.total_questions,
                availableQuestions,
              );
              const helperText =
                availableQuestions === 0
                  ? "Bu konu için henüz test sorusu yok."
                  : hasResult
                    ? `Son test sonucu: ${goal.correct_answers}/${goal.total_questions} doğru`
                    : "Henüz çözülmedi.";

              return (
                <div
                  key={goal.id}
                  style={{
                    marginBottom: 14,
                    padding: 12,
                    background: "#f9fafb",
                    border: "1px solid #eef2f7",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <span
                        style={{
                          padding: "3px 7px",
                          borderRadius: 999,
                          background: "#eff6ff",
                          color: "#2563eb",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        H{goal.week_index + 1}
                      </span>
                      <span
                        style={{
                          padding: "3px 7px",
                          borderRadius: 999,
                          background: assessmentVisual.badgeBg,
                          color: assessmentVisual.badgeColor,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {assessmentVisual.label}
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#374151",
                          lineHeight: 1.5,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                        title={goal.topic_title}
                      >
                        {goal.label}
                      </div>
                      {goal.custom_label && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "#9ca3af",
                            marginTop: 4,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={goal.topic_title}
                        >
                          Asıl konu: {goal.topic_title}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => startEditGoal(goal)}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
                        background: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      title="Kısa adı düzenle"
                    >
                      <Edit2 size={12} color="#6b7280" />
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${goal.progress}%`,
                          background: assessmentVisual.barColor,
                          borderRadius: 999,
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 11, color: "#6b7280", width: 34, textAlign: "right" }}>
                      {goal.progress}%
                    </span>
                  </div>
                  <p style={{ fontSize: 11, color: "#9ca3af", margin: "8px 0 0", lineHeight: 1.4 }}>
                    {helperText}
                  </p>
                </div>
              );
            })}
          </div>

          <hr style={{ border: "none", borderTop: "1px solid #f3f4f6", margin: "0 0 24px" }} />

          <div>
            <div style={{ display: "flex", alignItems: "center", fontWeight: 600, marginBottom: 14, color: "#1f2937" }}>
              <BarChart2 size={15} style={{ marginRight: 8, color: "#6b7280" }} />
              Haftalik Aktivite
            </div>
            {(
              [
                ["Konu Kavrama", "#3b82f6", [20, 35, 40, 60, 80, 100]],
                ["Muhakeme Hizi", "#10b981", [15, 25, 45, 55, 70, 85]],
              ] as [string, string, number[]][]
            ).map(([label, color, bars]) => (
              <div key={label} style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>{label}</p>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28 }}>
                  {bars.map((height, index) => (
                    <div
                      key={index}
                      style={{
                        flex: 1,
                        height: `${height}%`,
                        background: color,
                        borderRadius: "2px 2px 0 0",
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}