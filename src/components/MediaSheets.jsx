import ConfirmSheet from './ConfirmSheet'

// Confirmation sheets shared by the Classic and Modern layouts (wording must not drift between them).
export function RemoveSeriesSheet({ show, onRemove, onClose }) {
  return <ConfirmSheet title="Remove series from Sonarr?"
    description={`“${show.title}” will leave Sonarr. Choose whether to keep its files or delete them from disk.`}
    actions={[{ label: 'Remove from Sonarr — Keep Files', run: () => onRemove(false) },
      { label: 'Delete and Remove from Sonarr', run: () => onRemove(true) }]}
    onClose={onClose} />
}

export function SeasonDeleteSheet({ show, season, onDelete, onClose }) {
  return <ConfirmSheet title={`Delete Season ${season} files?`}
    description={`Delete downloaded Season ${season} files of “${show.title}” and unmonitor those episodes in Sonarr. The series stays in your library.`}
    actions={[{ label: 'Delete and Unmonitor', run: () => onDelete(season) }]}
    onClose={onClose} />
}

export function EpisodeDeleteSheet({ ep, onDelete, onClose }) {
  return <ConfirmSheet title="Delete episode file?"
    description={`Delete “${ep.title}” from disk and unmonitor it in Sonarr. The episode stays in your library.`}
    actions={[{ label: 'Delete and Unmonitor', run: onDelete }]}
    onClose={onClose} />
}

export function MovieDeleteSheet({ movie, canRemove, onUnmonitor, onRemove, onClose }) {
  return <ConfirmSheet title="Delete movie?" description={`“${movie.title}”: Delete and Unmonitor deletes the file but keeps the movie in Radarr, unmonitored. Delete and Remove deletes files and removes the movie from Radarr.${canRemove ? '' : ' Removing movies needs ArrView Server 1.08 or later.'}`}
    actions={[
      { label: 'Delete and Unmonitor', run: onUnmonitor },
      ...(canRemove ? [{ label: 'Delete and Remove from Radarr', run: onRemove }] : []),
    ]} onClose={onClose} />
}
