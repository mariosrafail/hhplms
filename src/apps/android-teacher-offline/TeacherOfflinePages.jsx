import { TeacherClassroomPages } from "./TeacherClassroomPages.jsx";
import TeacherOfflineEmbeddedActivity from "./TeacherOfflineEmbeddedActivity.jsx";
import { usePublishedComponentRelease } from "virtual:component-publication";

export default function TeacherOfflinePages(props) {
  return props.classroom ? <TeacherClassroomPages {...props} ActivityRenderer={TeacherOfflineEmbeddedActivity} publication={props.classroom.publication} /> : <LegacyTeacherPages {...props} />;
}
function LegacyTeacherPages(props) {
  const publication = usePublishedComponentRelease({ runtimeContext: props.runtimeContext, identity: props.componentIdentity });
  return <TeacherClassroomPages {...props} publication={publication} ActivityRenderer={TeacherOfflineEmbeddedActivity} />;
}
