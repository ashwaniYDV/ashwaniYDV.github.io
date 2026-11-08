// All site content lives here so updating the portfolio is a data-only change.

const images = import.meta.glob("./assets/images/*", {
  eager: true,
  import: "default",
});

/** Resolve a file in src/assets/images to its bundled URL. */
export const img = (name) => images[`./assets/images/${name}`];

export const RESUME_URL =
  "https://drive.google.com/file/d/1kv5wctnszrn-0KLncFzsKl2DrmXp8saM/view?usp=sharing";

export const FORMSPREE_URL = "https://formspree.io/mqkygoae";

export const socials = [
  { name: "LinkedIn", icon: "fa-linkedin", url: "https://linkedin.com/in/ashwaniydv" },
  { name: "Facebook", icon: "fa-facebook", url: "https://www.facebook.com/ashwani.iitp18" },
  { name: "GitHub", icon: "fa-github", url: "https://github.com/ashwaniYDV" },
  { name: "Instagram", icon: "fa-instagram", url: "https://instagram.com/ashwani_fit" },
  { name: "Twitter", icon: "fa-twitter", url: "https://twitter.com/ashwani_iitp" },
];

export const menuLinks = [
  { label: "Home", href: "#" },
  { label: "Intro", href: "#intro" },
  { label: "Worked", href: "#worked" },
  { label: "Alma-Matter", href: "#alma-matter" },
  { label: "Projects", href: "#projects" },
];

// `variant` maps to the Solid State wrapper classes used by the original page.
const LIGHT = "style1";
const DARK = "style2 alt";

export const work = [
  {
    variant: DARK,
    title: "Amazon - SDE2",
    url: "https://amazon.com/",
    image: "amzn1.gif",
    imageStyle: { borderRadius: "20%", width: "70%" },
    lines: ["Joined 'Seller Fulfilment Tech' Team .", "May 2025 – Present"],
    description: "Got exposure to AWS, compliance, governance, etc",
  },
  {
    variant: LIGHT,
    title: "Twilio - SDE2",
    url: "https://twilio.com/",
    image: "twilio.gif",
    imageStyle: { borderRadius: "20%", width: "70%" },
    lines: [
      "Joined 'Data Governance & Insights' Team as a backend developer.",
      "Dec 2024 – May 2025",
    ],
    description:
      "Got exposure to Data Platform, Big Data Pipelines, Spark, Clickhouse, Kubernetes, Service-mesh, etc",
  },
  {
    variant: DARK,
    title: "Flipkart - SDE1",
    url: "https://flipkart.com/",
    image: "flipkart-gif.gif",
    imageStyle: { borderRadius: "20%", width: "40%" },
    lines: [
      "Working as a SDE in the Marketplace (Seller Support) Team",
      "June 2022 – March 2023",
    ],
    description: "Got exposure to Java Dropwizard, Kafka, ElasticSearch",
  },
  {
    variant: LIGHT,
    title: "Zomato- SDE Intern",
    url: "https://zomato.com/",
    image: "zomato3.gif",
    imageStyle: { borderRadius: "20%" },
    lines: ["Worked in Logistics Tech Team as a backend developer.", "Jan – April 2022"],
    description:
      "Got exposure to Apache Kafka, Elastic Search, Pub-Sub, gRPC, Microservices in Golang, Ruby on Rails",
  },
  {
    variant: DARK,
    title: "Success Numbers Pvt. Ltd. - SWE Intern",
    url: "https://snumbers.com/",
    image: "snumbers.png",
    flatImage: true,
    lines: [
      "Worked on OMS (Order Management System) and developed microservices for tracking whole order life-cycle",
      "May – July 2021",
    ],
    description:
      "Developed various API’s in the OMS-backend in Springboot and developed admin portal in React. Added lambda functions in AWS for serverless functionalities and integrated SNS and SQS for managing order fulfilments and inventories. Got exposure to Java, Springboot, JPA, Hibernate, React, AWS (Lambda, SNS, SQS, SES)",
  },
  {
    variant: LIGHT,
    title: "Scaler (by Interviewbit) - DSA Teaching Assistant",
    url: "https://scaler.com/",
    image: "scaler.svg",
    flatImage: true,
    lines: ["Worked as a teaching assistant for DSA and System Design.", "2021 – 2023"],
    description:
      "Worked as a teaching assistant + mentoring + solving doubts of university students and working professionals in Data Structures & Algorithms.",
  },
  {
    variant: DARK,
    title: "Google Summer of Code - Sophomore year",
    url: "https://summerofcode.withgoogle.com/",
    image: "gsoc_logo.png",
    flatImage: true,
    lines: [
      "Student developer at GSoC 2020 for RocketChat",
      "Omnichannel: Add screen sharing feature in the Livechat widget",
      "May – September 2020",
    ],
    description: (
      <>
        Rocket.Chat is the <b>world&apos;s largest open source</b> communications platform.
        <br />I worked with Rocket.Chat organization where I implemented screen sharing feature
        in the live-chat widget by developing a generic screen-sharing provider. Implemented
        API’s in RocketChat’s JS-SDK so that agents could get real-time screen-share on
        customer’s devices. Got exposure to Typescript, MeteorJS, RocketChat SDK, RocketChat
        Apps-Engine, MongoDB, Dependency Inversion
      </>
    ),
    links: [
      {
        label: "View project",
        url: "https://summerofcode.withgoogle.com/archive/2020/projects/4804104636858368/",
      },
      {
        label: "GSoC Work Report",
        url: "https://gist.github.com/ashwaniYDV/d8fcd258e3725bde8e10eac669de5f80",
      },
    ],
  },
  {
    variant: LIGHT,
    title: "Inter IIT Tech Meet 8.0, IIT Roorkee",
    url: "https://www.facebook.com/interiit.tech",
    image: "interiittechmmeet.png",
    flatImage: true,
    lines: [
      'I with my team won Gold Medal for the event "Ashoka\'s Tech for Change"',
      "Fullstack Web and Blockchain Developer",
      "October – December 2019",
    ],
    description:
      "Problem Statement: With the vision, “Technology is not an end in itself, it’s a means to an end”, participants are supposed to develop a product using technology to solve an existing societal problem. Also, form a suitable business model around the same.",
    links: [{ label: "Inter IIT Tech Meet", url: "https://www.facebook.com/interiit.tech" }],
  },
  {
    variant: DARK,
    title: "NJACK IITPatna",
    titleStyle: null,
    url: "https://njack.iitp.ac.in/",
    image: "njackLogo.png",
    flatImage: true,
    lines: [
      "Advisor: Development & Open Source",
      <>
        Sep 2019 – Present
        <br />
        Location: IIT Patna
      </>,
    ],
    description:
      "NJACK (Not Just Another Computer Science Klub!) is the official Computer Science Club of IIT Patna",
    links: [{ label: "Visit site", url: "https://njack.iitp.ac.in/" }],
  },
];

export const education = [
  {
    variant: LIGHT,
    title: "Indian Institute of Technology, Patna - IIT P",
    titleStyle: { textTransform: "none", fontFamily: "'Josefin Sans', sans-serif" },
    url: "https://www.iitp.ac.in/",
    image: "iitp.png",
    flatImage: true,
    lines: ["Bachelors in Technology", "Major: Electrical Engineering"],
    description:
      "The Indian Institute of Technology Patna is an autonomous institute of education and research in science, engineering and technology located in Patna, India. It is recognized as an Institute of National Importance by the Government of India.",
    linkClassName: "special myfont",
    links: [{ label: "Learn more", url: "https://www.iitp.ac.in/" }],
  },
  {
    variant: DARK,
    title: "Methodist High School, Kanpur",
    titleClassName: "major myfont",
    titleStyle: null,
    image: "mhs.png",
    lines: ["Primary-Middle-High School"],
    linkClassName: "special myfont",
    links: [
      {
        label: "Learn more",
        url: "https://en.wikipedia.org/wiki/Methodist_High_School,_Kanpur",
      },
    ],
  },
];

export const projects = [
  {
    title: "Zero-shot Image Recognition",
    description:
      "I have worked for Academic Project (CS244-Introduction to data science). My topic was Image classification using Zero-shot Image Recognition. Zero-Shot learning method aims to solve a task without receiving any example of that task at training phase. It simply allows us to recognize objects we have not seen before.",
    links: [
      { label: "View on Github", url: "https://github.com/ashwaniYDV/Zero-shot-Image-Recognition" },
    ],
  },
  {
    title: "IIT Patna Utility App",
    description:
      "Built institute utility app for IIT-P students. IITP institute app This is the official app for Indian Institute of Technology Patna. Its main motive is to organise all the resources needed frequently at one place for the students of IIT Patna.",
    links: [
      {
        label: "Android App",
        url: "https://play.google.com/store/apps/details?id=com.grobo.notifications&hl=en",
      },
      { label: "View on Github", url: "https://github.com/doDev-IITP/IITP-Webapp" },
      { label: "Live Website", url: "http://iitpapp.herokuapp.com/" },
    ],
  },
  {
    title: "Handwritten-Digit Prediction",
    description:
      "Handwritten Digit Prediction using Convolutional Neural Networks in TensorFlow with Keras and Live Example using TensorFlow.js",
    links: [
      { label: "View on Github", url: "https://github.com/ashwaniYDV/Handwritten-Digit-Prediction" },
      { label: "Live Website", url: "https://ashwaniyadav.tech/Handwritten-Digit-Prediction/" },
    ],
  },
  {
    title: "Graphql Apollo React stack realtime chat app",
    description:
      "Built a chat app using Graphql, NodeJS, Apollo, React, MySql, JWT, React-Bootstrap with user authentication and message reaction support. Users can do realtime chat and react to messages with emojis with their peers",
    links: [{ label: "View on Github", url: "https://github.com/ashwaniYDV/MyChatQL" }],
  },
];
