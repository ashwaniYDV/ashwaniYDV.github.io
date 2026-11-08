/** Small "Saved locally" / "Couldn't save" hint shared by the utilities. */
export default function SaveStatus({ status }) {
  if (status === "error") {
    return (
      <span className="save-status is-error" role="status">
        <i className="fa fa-exclamation-triangle" aria-hidden="true"></i> Couldn&apos;t save (storage full or disabled)
      </span>
    );
  }
  return (
    <span className="save-status" role="status">
      <i className="fa fa-check" aria-hidden="true"></i> Saved in this browser
    </span>
  );
}
