function Worked() {
    const data = [
        {
            className: "style2 alt",
            link: "https://flipkart.com/",
            imgSrc: "assets/images/flipkart-gif2.gif",
            content: {
                position: "Flipkart - SDE1",
                role: "Working as a SDE in the Marketplace (Seller Support) Team",
                date: "June 2022 – Present",
                desc: ["Got exposure to Java Dropwizard, Kafka, ElasticSearch"]
            }
        },
        {
            className: "style1",
            link: "https://zomato.com/",
            imgSrc: "assets/images/zomato3.gif",
            content: {
                position: "Zomato- SDE Intern",
                role: "Worked in Logistics Tech Team as a backend developer.",
                date: "Jan – April 2022",
                desc: ["Got exposure to Apache Kafka, Elastic Search, Pub-Sub, gRPC, Microservices in Golang, Ruby on Rails"]
            }
        },
        {
            className: "style2 alt",
            link: "https://snumbers.com/",
            imgSrc: "assets/images/snumbers.png",
            content: {
                position: "Success Numbers Pvt. Ltd. - SWE Intern",
                role: "Worked on OMS (Order Management System)",
                date: "May – July 2021",
                desc: ["Developed microservices for tracking whole order life-cycle. Developed various API’s in the OMS-backend in Springboot and developed admin portal in React.", "Added lambda functions in AWS for serverless functionalities and integrated SNS and SQS for managing order fulfilments and inventories.", "Got exposure to Java, Springboot, JPA, Hibernate, React, AWS (Lambda, SNS, SQS, SES)"]
            }
        },
        {
            className: "style1",
            link: "https://scaler.com/",
            imgSrc: "assets/images/scaler.svg",
            content: {
                position: "Scaler (by Interviewbit) - DSA Teaching Assistant",
                role: "Worked as a teaching assistant for DSA and System Design.",
                date: "2021 – 2023",
                desc: ["Worked as a teaching assistant + mentoring + sloving doubts of university students and working professionals in Data Structures & Algorithms."]
            }
        },
        {
            className: "style2 alt",
            link: "https://summerofcode.withgoogle.com/",
            imgSrc: "assets/images/gsoc_logo.png",
            content: {
                position: "Google Summer of Code - Student developer @RocketChat",
                role: "Omnichannel: Add screen sharing feature in the Livechat widget",
                date: "May – September 2020",
                desc: ["Rocket.Chat is the world's largest open source communications platform.", "I implemented screen sharing feature in the live-chat widget by developing a generic screen-sharing provider. Implemented API’s in RocketChat’s JS-SDK so that agents could get real-time screen-share on customer’s devices.", "Got exposure to Typescript, MeteorJS, RocketChat SDK, RocketChat Apps-Engine, MongoDB, Dependency Inversion"],
                links: [
                    {
                        src: "https://summerofcode.withgoogle.com/archive/2020/projects/4804104636858368/",
                        title: "View project"
                    },
                    {
                        src: "https://gist.github.com/ashwaniYDV/d8fcd258e3725bde8e10eac669de5f80",
                        title: "GSoC Work Report"
                    },
                ]
            }
        },
        {
            className: "style1",
            link: "https://www.facebook.com/interiit.tech",
            imgSrc: "assets/images/interiittechmmeet.png",
            content: {
                position: "Inter IIT Tech Meet 8.0, IIT Roorkee",
                role: "Fullstack Web and Blockchain Developer",
                date: "October – December 2019",
                desc: ["Me with my team won Gold Medal for the event \"Ashoka's Tech for Change\",", "Problem Statement: With the vision, “Technology is not an end in itself, it’s a means to an end”, participants are supposed to develop a product using technology to solve an existing societal problem. Also, form a suitable business model around the same."]
            }
        },
        {
            className: "style2 alt",
            link: "https://njack.iitp.ac.in/",
            imgSrc: "assets/images/njackLogo.png",
            content: {
                position: "NJACK IITPatna",
                role: "Advisor: Development & Open Source",
                date: "Sep 2019 – Present",
                location: "IIT Patna",
                desc: ["NJACK (Not Just Another Computer Science Klub!) is the official Computer Science Club of IIT Patna"],
                links: [
                    {
                        src: "https://njack.iitp.ac.in/",
                        title: "Visit site"
                    },
                ]
            }
        },
    ]
    return (
        <>
            {data.map((e) => (
                <section id="two" className={`wrapper spotlight ${e.className}`}>
                    <div className="inner">
                        <a target="_blank"
                            href={e.link}
                            className="image zeroradius">
                                <img className="zeroradius" src={e.imgSrc} alt="" style={{ borderRadius: "20%" }} />
                        </a>
                        <div className="content">
                            <h2 className="major myfont" style={{ textTransform: "none !important" }}
                            >{e.content.position}</h2>
                            <h3 className="nomargin myfont">{e.content.role}</h3>
                            <h3 className="nomargin myfont">{e.content.date}</h3>
                            {e.content.location && <h3 className="nomargin myfont">{e.content.location}</h3>}
                            
                            <p>
                                {
                                    e.content.desc.map((d) => (
                                        <>{d}<br/></>
                                    ))
                                }
                            </p>

                            {
                                e.content.links && e.content.links.map((link) => (
                                    <a href={link.src} target="_blank" className="special">{link.title}</a>
                                ))
                            }
                        </div>
                    </div>
                </section>
            ))}
        </>
    )
}

export default Worked;