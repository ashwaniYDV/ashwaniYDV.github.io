import { img } from "../data.jsx";

export default function Etc() {
  return (
    <section id="three" className="wrapper spotlight style1 alt">
      <div className="inner">
        <a href="#" className="image">
          <img src={img("guitar.jpg")} alt="Playing guitar" />
        </a>
        <div className="content">
          <h1>Hi, I’m Ashwani, the guy behind and front of this site!</h1>
          <p style={{ margin: 0 }}>
            The following are a few things I do or used to do before when I&apos;m not coding:
          </p>
          <ul>
            <li>Playing Guitar</li>
            <li>Workout</li>
            <li>Listening to Music!</li>
          </ul>
          <p style={{ margin: 0 }}>My favourite:</p>
          <ul>
            <li>Poem: The Road Not Taken by Robert Frost</li>
            <li>Footballer: CR7</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
