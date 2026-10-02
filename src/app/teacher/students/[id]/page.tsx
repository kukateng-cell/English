import TeacherStudentDetail from "@/components/teacher/TeacherStudentDetail";

export default async function TeacherStudentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  return <TeacherStudentDetail studentId={id} from={query.from === "progress" ? "progress" : "roster"} />;
}
