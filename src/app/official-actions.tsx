import { FsCard } from "./fs-shell";

export type StoredGuide = {
  actions: { action_no: number; title?: string; detail?: string; action_code: string }[];
  channels: { action_no: number; display_value: string }[];
};
export function OfficialActions({ guide, title = "공식 확인 행동" }: { guide?: StoredGuide | null; title?: string }) {
  if (!guide?.actions?.length) return null;
  return <FsCard>
    <h2 className="fs-h2">{title}</h2>
    <ol className="mt-3 space-y-3">{guide.actions.map(action => <li key={action.action_no}>
      <p className="font-semibold">{action.title ?? "공식 창구에 확인하세요"}</p>
      {action.detail ? <p className="fs-body mt-1">{action.detail}</p> : null}
      {guide.channels.filter(channel => channel.action_no === action.action_no).map(channel =>
        <p className="fs-body mt-2 font-semibold" key={channel.display_value}>{channel.display_value}</p>)}
    </li>)}</ol>
  </FsCard>;
}
