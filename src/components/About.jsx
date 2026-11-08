import { img, skills } from "../data";

export default function About() {
  return (
    <section id="one" className="wrapper spotlight style1">
      <div className="inner">
        <a className="image">
          <img src={img("octocat.png")} alt="GitHub Octocat" />
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
          {skills.length > 0 && (
            <ul className="skill-chips" aria-label="Toolbox">
              {skills.map((skill) => (
                <li key={skill}>{skill}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <span id="worked"></span>
    </section>
  );
}
