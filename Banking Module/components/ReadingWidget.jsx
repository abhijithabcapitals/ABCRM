// Round progress for document reading, and the corner card that follows staff around the CRM while it runs.
import "./reading.css";
import { discardReading, requestOpen, useReadingJob } from "../services/readingJob";

export function ProgressRing({ percent, size = 56 }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="crm-ring" width={size} height={size} viewBox="0 0 48 48" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Reading documents">
      <circle className="crm-ring-track" cx="24" cy="24" r={radius} />
      <circle className="crm-ring-value" cx="24" cy="24" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} transform="rotate(-90 24 24)" />
      <text x="24" y="24" dy="0.35em" textAnchor="middle">{percent}%</text>
    </svg>
  );
}

export const readingText = (job) => `${job.done} of ${job.total} document(s) read`;

export default function ReadingWidget({ owner, onOpen }) {
  const job = useReadingJob();
  if (!job || job.owner !== owner) return null;
  const open = () => { requestOpen(); onOpen(job.view); };
  return (
    <aside className="crm-reading" aria-live="polite">
      <ProgressRing percent={job.percent} />
      <div className="crm-reading-text">
        {job.status === "reading" && <><strong>Reading {job.label}</strong><span>{readingText(job)}. You can keep working. Keep this browser tab open.</span></>}
        {job.status === "done" && <><strong>Finished reading {job.label}</strong><span>Continue to check the details.</span></>}
        {job.status === "failed" && <><strong>Could not read {job.label}</strong><span>{job.error}</span></>}
        <span className="crm-reading-actions">
          <button type="button" className="crm-reading-open" onClick={open}>{job.status === "reading" ? "Open" : "Continue"}</button>
          <button type="button" className="crm-reading-stop" onClick={discardReading}>{job.status === "reading" ? "Stop" : "Dismiss"}</button>
        </span>
      </div>
    </aside>
  );
}
