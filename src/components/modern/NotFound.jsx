export default function NotFound({ kind }) {
  const show = kind === 'show'
  return <div className="m-notfound">
    <h1>Not found</h1>
    <p>{show ? 'That show could not be found.' : 'That movie could not be found.'}</p>
    <a className="m-textlink" href={show ? '#/shows' : '#/movies'}>{show ? 'Back to TV Shows' : 'Back to Movies'}</a>
  </div>
}
