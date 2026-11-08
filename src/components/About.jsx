import { img } from "../data";
import { useTilt } from "../hooks.js";

export default function About() {
  const tiltRef = useTilt();

  return (
    <section id="one" className="wrapper spotlight style1">
      <div className="inner">
        <a className="image">
          <img ref={tiltRef} src={img("octocat.png")} alt="GitHub Octocat" />
        </a>
        <div className="content">
          <h2 className="major myfont">About Me!</h2>
          <h3 className="major myfont">Presently: SDE-2 at AWS (Aurora PostgreSQL)</h3>
          <p className="myfont">
            Student Developer at Google Summer of Code with RocketChat
            <br />
            Open-source Contributor: <a href="https://github.com/duckdb/duckdb/">@duckdb</a>,{" "}
            <a href="https://github.com/dicedb/dice/">@dicedb</a>,{" "}
            <a href="https://github.com/RocketChat/Rocket.Chat/">@RocketChat</a>
            <br />
            Developer, Open source enthusiast, code fanatic ♥
          </p>
        </div>
      </div>
      <span id="worked"></span>
    </section>
  );
}
