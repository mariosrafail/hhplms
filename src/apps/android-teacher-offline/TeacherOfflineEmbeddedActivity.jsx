import { EmbeddedActivityFrame } from "./EmbeddedActivityFrame.jsx";

import { ACTIVITY_MODES } from "../../components/lms/activities/activityModes.js";
import { activeBuildProfile } from "../../config/buildProfiles.js";
import { NormalizedStudentsBookActivity } from "../../components/lms/activities/ultimate-b2/NormalizedStudentsBookActivity.jsx";
import { PublishedNativeTeacherActivityRunner as PublishedNativeActivityRunner } from "../../components/lms/activities/ultimate-b2/PublishedNativeTeacherActivityRunner.jsx";
import { HostedNativeDraftActivityRunner } from "../../components/lms/activities/ultimate-b2/HostedNativeDraftActivityRunner.jsx";
import { findStudentsBookImplementation } from "../../data/ultimate-b2/studentsBookCatalog.js";
import TeacherOfflineActivityVideoOverlay from "./TeacherOfflineActivityVideoOverlay.jsx";
import multipleChoiceAuthoring from "virtual:ultimate-b2-multiple-choice-presentation";
import { useHostedOpenResponseDraft, useHostedOpenResponseImport } from "virtual:ultimate-b2-hosted-open-response-drafts";
import { usePublishedComponentRelease } from "virtual:component-publication";
import { useHostedNativeDraftActivity } from "virtual:hosted-native-drafts";
import { HOSTED_VIEWER_RUNTIME_MODES, resolveHostedViewerRuntimeContext } from "./hostedReleasePreview.js";

export default function TeacherOfflineEmbeddedActivity(props) {
  const { classroom, activityId, activityPresentationCommand, onActivityPresentationStateChange, onVideoWorksheetActionChange } = props;
  const entry = classroom?.publication.projection.nativeActivities?.[activityId];
  return <EmbeddedActivityFrame activityId={activityId} title={props.title} overlay={props.videoOpen ? <TeacherOfflineActivityVideoOverlay activityId={activityId} onClose={props.onCloseVideo} /> : null}>
    {classroom ? entry ? <PublishedNativeActivityRunner entry={entry} publication={classroom.publication} teacherMode={classroom.teacherMode} delivery={classroom.delivery} showMetadataHeader={false}
      presentation={{ command: activityPresentationCommand, onStateChange: onActivityPresentationStateChange, onWorksheetActionChange: onVideoWorksheetActionChange }} /> : <p role="alert">Activity is unavailable in this source.</p> : <LegacyEmbeddedActivity {...props} />}
  </EmbeddedActivityFrame>;
}

function LegacyEmbeddedActivity({ activityId, title, videoOpen = false, onCloseVideo, listeningShowTextCommand = 0, onListeningStateChange, activityPresentationCommand = null, onActivityPresentationStateChange, onVideoWorksheetActionChange, runtimeContext, componentIdentity }) {
  const hostedOpenResponseDraft = useHostedOpenResponseDraft(activityId, { runtimeContext });
  const hostedOpenResponseImport = useHostedOpenResponseImport(activityId, { runtimeContext });
  const publication = usePublishedComponentRelease({ runtimeContext, identity: componentIdentity });
  const publishedNative = publication.kind === "published" ? publication.projection.nativeActivities?.[activityId] : null;
  const effectiveRuntimeContext = runtimeContext || resolveHostedViewerRuntimeContext();
  const nativeDraftCandidate = effectiveRuntimeContext.kind === HOSTED_VIEWER_RUNTIME_MODES.BUILDER_PREVIEW && !findStudentsBookImplementation(activityId);
  const teacherPreview = activeBuildProfile.teacherPresentation
    || (activeBuildProfile.authorizedTeacherPreview && effectiveRuntimeContext.teacherPreview);
  const hostedNativeDraft = useHostedNativeDraftActivity(nativeDraftCandidate ? activityId : null, { teacherMode: teacherPreview, runtimeContext: effectiveRuntimeContext, identity: componentIdentity });
  const activityMode = teacherPreview
    ? ACTIVITY_MODES.TEACHER_PRESENTATION_OFFLINE
    : ACTIVITY_MODES.ANDROID_OFFLINE;

  return (publishedNative ? <PublishedNativeActivityRunner entry={publishedNative} publication={publication} teacherMode={teacherPreview} showMetadataHeader={false} presentation={{ command: activityPresentationCommand, onStateChange: onActivityPresentationStateChange, onWorksheetActionChange: onVideoWorksheetActionChange }} /> : nativeDraftCandidate ? <HostedNativeDraftActivityRunner activityId={activityId} state={hostedNativeDraft} teacherMode={teacherPreview} showMetadataHeader={false} presentation={{ command: activityPresentationCommand, onStateChange: onActivityPresentationStateChange, onWorksheetActionChange: onVideoWorksheetActionChange }} runtimeContext={effectiveRuntimeContext} identity={componentIdentity} /> : <NormalizedStudentsBookActivity
          key={activityId}
          activityId={activityId}
          activityPublicDraft={hostedOpenResponseDraft}
          activityPublicImport={hostedOpenResponseImport.publicImport}
          activityTeacherSolution={hostedOpenResponseImport.teacherSolution}
          mode={activityMode}
          listeningPresentation={{ showTextCommand: listeningShowTextCommand, onStateChange: onListeningStateChange }}
          activityPresentation={{
            command: activityPresentationCommand,
            onStateChange: onActivityPresentationStateChange,
            multipleChoiceAuthoring: teacherPreview && activityId === multipleChoiceAuthoring?.activityId ? multipleChoiceAuthoring : null,
          }}
        />);
}
