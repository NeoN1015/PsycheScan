/** Red / amber warning banner (spec §11). kind: "red" | "amber" */
export default function Banner({ kind = "amber", children }) {
  return (
    <div className={"banner " + kind} role={kind === "red" ? "alert" : "status"}>
      {children}
    </div>
  );
}
