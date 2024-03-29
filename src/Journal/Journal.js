import React, { useState, useEffect } from 'react';
import { EditorState } from 'draft-js';
import { Editor } from 'react-draft-wysiwyg';
import { convertToRaw } from 'draft-js';
import { convertFromRaw } from 'draft-js';

import "react-draft-wysiwyg/dist/react-draft-wysiwyg.css";

const Journal = () => {
  const [editorState, setEditorState] = useState(EditorState.createEmpty());

  // Function to handle saving data to the database
  const saveToDatabase = () => {
    const contentState = editorState.getCurrentContent();
    const contentRaw = convertToRaw(contentState);
    localStorage.removeItem("editor_state")
    localStorage.setItem("editor_state", JSON.stringify(contentRaw));    
  };

  // Function to load data from the database
  const loadFromDatabase = () => {
    let content = localStorage.getItem("editor_state");
    if (content) {
        content = JSON.parse(content);
        const contentState = convertFromRaw(content);
        setEditorState(EditorState.createWithContent(contentState));
    }
        
  };

  useEffect(() => {
    // Load data from the database when the component mounts
    loadFromDatabase();
  }, []);

  return (
    <div>
      <Editor
        editorState={editorState}
        onEditorStateChange={setEditorState}
      />
      <button onClick={saveToDatabase}>Save to Database</button>
      <button onClick={loadFromDatabase}>Load from Database</button>
    </div>
  );
};

export default Journal;
