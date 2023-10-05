function Projects() {
    return (
        <section id="four" className="wrapper style1">
            <div className="inner">
                <h2 className="major">Highlights</h2>
                <p>This section contains some of my the things I've worked on before.
                    <br />Many more such projects
                    can be found at <a target="_blank" href="https://github.com/ashwaniYDV">GitHub</a></p>
                <section className="features">
                    <article>
                        <h3 className="major">Zero-shot Image Recognition</h3>
                        <p>I have worked for Academic Project (CS244-Introduction to data science). My topic was Image classification using Zero-shot Image Recognition.
                            Zero-Shot learning method aims to solve a task without receiving any example of that task at training phase.
                            It simply allows us to recognize objects we have not seen before.
                        </p>
                        <a target="_bl" href="https://github.com/ashwaniYDV/Zero-shot-Image-Recognition" className="special">View on Github</a>
                    </article>
                    <article>
                        <h3 className="major">IIT Patna Utility App</h3>
                        <p>Built institute utility app for IIT-P students. IITP institute app This is the official app for Indian Institute of Technology Patna. Its main motive is to organise all the resources needed frequently at one place for the students of IIT Patna.</p>
                        <a target="_bl" href="https://play.google.com/store/apps/details?id=com.grobo.notifications&hl=en" className="special">Android App</a>
                        <a target="_bl" href="https://github.com/doDev-IITP/IITP-Webapp" className="special">View on Github</a>
                        <a target="_bl" href="http://iitpapp.herokuapp.com/" className="special">Live Website</a>
                    </article>
                    <article>
                        <h3 className="major">Handwritten-Digit Prediction</h3>
                        <p>Handwritten Digit Prediction using Convolutional Neural Networks in TensorFlow with Keras and Live Example using TensorFlow.js</p>
                        <a target="_bl" href="https://github.com/ashwaniYDV/Handwritten-Digit-Prediction" className="special">View on Github</a>
                        <a target="_bl" href="https://ashwaniyadav.tech/Handwritten-Digit-Prediction/" className="special">Live Website</a>
                    </article>
                    <article>
                        <h3 className="major">Graphql Apollo React stack realtime chat app</h3>
                        <p>Built a chat app using Graphql, NodeJS, Apollo, React, MySql, JWT, React-Bootstrap with user authentication and message reaction support.
                            Users can do realtime chat and react to messages with emojis with their peers</p>
                        <a target="_bl" href="https://github.com/ashwaniYDV/MyChatQL" className="special">View on Github</a>
                    </article>
                </section>
                <ul className="actions">
                    <li><a target="_blank" href="https://github.com/ashwaniYDV" className="button">Browse All</a></li>
                </ul>
            </div>
        </section>
    )
}

export default Projects