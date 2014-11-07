/*
 * Copyright 2014 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*global: l:false*/
/*global: generateUUID:false*/
/*global: util:false*/

var RtcommEndpoint = (function invocation(){

  /**
   * @memberof module:rtcomm.RtcommEndpoint
   *
   * @description 
   * A Chat is a connection from one peer to another to pass text back and forth
   *
   *  @constructor
   *  @extends  module:rtcomm.util.RtcommBaseObject
   */
  var Chat = function Chat(parent) {
    // Does this matter?
    var createChatMessage = function(message) {
      return {'type':'user', 'userdata': {'message': message, 'from': parent.userid}};
    };
    var chat = this;
    this._ = {};
    this._.objName = 'Chat';
    this._.parentConnected = false;
    this._.enabled = false;
    this.onEnabledMessage = null;
    this.onDisabledMessage = null;
    this.state = 'disconnected';

    this.events = {
      'message': [],
      'connected': [],
      'alerting': [],
      'disconnected': []
    };
    /**
     * Send a message if connected, otherwise, 
     * enables chat for subsequent RtcommEndpoint.connect();
     * @param {string} message  Message to send when enabled.
     */  
    this.enable =  function(message) {
      this.onEnabledMessage = message || createChatMessage(parent.userid + ' has initiated a Chat with you');
      // Don't need much, just set enabled to true.
      // Default message
      this._.enabled = true;
      if (parent.sessionStarted()) {
        this._connect();
      }
      return this;
    };
    /**
     * Accept an inbound connection  
     */
    this.accept = function(message) {
      if (this.state === 'alerting') {
        this.enable(message || 'Accepting chat connection');
      }
    };
    /**
     * Reject an inbound session
     */
    this.reject = function() {
      // Does nothing.
    };
    /**
     * disable chat
     */
    this.disable = function(message) {
      if (this._.enabled) { 
        this._.enabled = false;
        this.onDisabledMessage = message|| createChatMessage(parent.userid + ' has left the chat');
        this.send(this.onDisabledMessage);
        this._setState('disconnected');
      }
      return null;
    };
    /**
     * send a chat message
     * @param {string} message  Message to send
     */
    this.send = function(message) {
      message = (message && message.message) ? message.message : message;
      message = (message && message.type === 'user') ? message : createChatMessage(message);
      if (parent._.activeSession) {
        parent._.activeSession.send(message);
      }
    };
    this._connect = function(sendMethod) {
      sendMethod = (sendMethod && typeof sendMethod === 'function') ? sendMethod : this.send.bind(this);
      if (this._.enabled) {
        this.onEnabledMessage && sendMethod({message: this.onEnabledMessage});
        this._setState('connected');
        return true;
      } else {
        console.log('!!!!! not enabled, skipping...'); 
        return false;
      }
    };
    this._processMessage = function(message) {
      // If we are connected, emit the message
      if (this.state === 'connected') {
        if (message.type === 'user') { 
          this.emit('message', message.userdata);
        } 
      } else {
        if (!parent.sessionStopped()) {
          this._setState('alerting', {'message': message.userdata});
        }
      }
      return this;
    };
    this._setState = function(state, object) {
      try {
        this.emit(state, object);
        this.state = state;
      } catch(error) {
        console.error(error);
        console.error(this+'._setState() unsupported state: '+state );
      }
    };

  };
  Chat.prototype = util.RtcommBaseObject.extend({});

  var createChat = function createChat(parent) {
    var chat = new Chat(parent);
    chat.on('message', function(message) {
      parent.emit('chat:message', {'message': message});
    });
    chat.on('alerting', function(obj) {
      obj = obj || {};
      obj.protocols = 'chat';
      parent.emit('session:alerting', obj );
    });
    chat.on('connected', function() {
      parent.emit('chat:connected');
    });
    chat.on('disconnected', function() {
      parent.emit('chat:disconnected');
    });

    return chat;
  };


  var createWebRTCConnection = function createWebRTCConnection(parent) {
    /* globals WebRTCConnection:false */
    var webrtc = new WebRTCConnection(parent);
    webrtc.on('ringing', function(event_obj) {
      parent.emit('session:ringing');
    });
    webrtc.on('alerting', function(event_obj) {
      parent.emit('session:alerting', {protocols: 'webrtc'});
    });
    webrtc.on('connected', function(event_obj) {
      parent.emit('webrtc:connected');
    });
    webrtc.on('disconnected', function(event_obj) {
      parent.emit('webrtc:disconnected');
    });
    return webrtc;
  };

/**
 *  @memberof module:rtcomm
 *  @description
 *  This object can only be created with the {@link module:rtcomm.EndpointProvider#getRtcommEndpoint|getRtcommEndpoint} function.
 *  <p>
 *  The RtcommEndpoint object provides an interface for the UI Developer to attach 
 *  Video and Audio input/output.  Essentially mapping a broadcast stream(a MediaStream that
 *  is intended to be sent) to a RTCPeerConnection output stream.   When an inbound stream
 *  is added to a RTCPeerConnection, then this also informs the RTCPeerConnection
 *  where to send that stream in the User Interface.
 *  <p>
 *  See the example under {@link module:rtcomm.EndpointProvider#getRtcommEndpoint|getRtcommEndpoint}
 *  @constructor
 *
 *  @extends  module:rtcomm.util.RtcommBaseObject
 */
  var RtcommEndpoint = function RtcommEndpoint(config) {
    // Presuming you creat an object based on this one, 
    // you must override the ession event handler and
    // then augment newSession object.
    //
    this.config = {
      ignoreAppContext: true,
      appContext : null,
      userid: null,
      chat: true,
      webrtc: true
    };
    this.dependencies = {
      endpointConnection: null,
    };
    // Private info.
    this._ = {
      objName: 'RtcommEndpoint',
      referralSession: null,
      activeSession: null,
      available: true,
      uuid: generateUUID(),
      initialized : false,
      // webrtc Only 
      inboundMedia: null,
      attachMedia: false,
      localStream : null,
      media : { In : null,
               Out: null},
    };
    var self = this;
    config && Object.keys(config).forEach(function(key) {
      self.config[key] = config[key];
    });
    // expose the ID
    this.id = this._.uuid;
    this.userid = this.config.userid || null;
    this.appContext = this.config.appContext || null;

    /**
     * The attached {@link module:rtcomm.RtcommEndpoint.WebRTCConnection} object 
     * if enabled null if not enabled
     *
     * @type {module:rtcomm.RtcommEndpoint.WebRTCConnection}
     * @readonly
     */
    this.webrtc = (this.config.webrtc)?createWebRTCConnection(this): null;
    /**
     * The attached {@link module:rtcomm.RtcommEndpoint.Chat} object 
     * if enabled null if not enabled
     *
     * @type {module:rtcomm.RtcommEndpoint.Chat}
     * @readonly
     */
    this.chat = (this.config.chat) ? createChat(this): null;
    // Enable chat by default if it is set up that way.
    //this.chat && this.chat.enable();

    /** 
     * RtcommEndpoint Event type 
     *
     *  @typedef {Object} module:rtcomm.RtcommEndpoint~Event
     *  @property {name} eventName 
     *  @property {object} endpointObject - an object passed with the event
     *  @property {string} [reason] - Used for failure messages
     *  @property {string} [protocols] - Used for alerting messages
     *  @property {object} [message] - Used for chat:message and session:alerting
     */

    this.events = {
        /**
         * A signaling session to a peer has been established
         * @event module:rtcomm.RtcommEndpoint#session:started
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        "session:started": [],
        /**
         * An inbound request to establish a call via 
         * 3PCC was initiated
         *
         * @event module:rtcomm.RtcommEndpoint#session:refer
         * @property {module:rtcomm.RtcommEndpoint~Event}
         *
         */
        "session:refer": [],
        /**
         * A peer has been reached, but not connected (inbound/outound)
         * @event module:rtcomm.RtcommEndpoint#session:ringing
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        "session:ringing": [],
        /**
         * An inbound connection is being requested.
         * @event module:rtcomm.RtcommEndpoint#session:alerting
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        "session:alerting": [],
        /**
         * A failure occurred establishing the session (check reason)
         * @event module:rtcomm.RtcommEndpoint#session:failed
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        "session:failed": [],
        /**
         * The remote party rejected establishing the session
         * @event module:rtcomm.RtcommEndpoint#session:rejected
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        "session:rejected": [],
        /**
         * The session has stopped
         * @event module:rtcomm.RtcommEndpoint#session:stopped
         * @property {module:rtcomm.RtcommEndpoint~Event}
         *
         */
        "session:stopped": [],
        /**
         * A PeerConnection to a peer has been established
         * @event module:rtcomm.RtcommEndpoint#webrtc:connected
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        "webrtc:connected": [],
        /**
         * The connection to a peer has been closed
         * @event module:rtcomm.RtcommEndpoint#webrtc:disconnected
         * @property {module:rtcomm.RtcommEndpoint~Event}
         *
         */
        "webrtc:disconnected": [],
        /**
         * Creating the connection to a peer failed
         * @event module:rtcomm.RtcommEndpoint#webrtc:failed
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        'webrtc:failed': [],
        /**
         * A message has arrived from a peer
         * @event module:rtcomm.RtcommEndpoint#chat:message
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        'chat:message': [],
        /**
         * A chat session to a  peer has been established
         * @event module:rtcomm.RtcommEndpoint#chat:connected
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        'chat:connected': [],
        /**
         * The connection to a peer has been closed
         * @event module:rtcomm.RtcommEndpoint#chat:disconnected
         * @property {module:rtcomm.RtcommEndpoint~Event}
         */
        'chat:disconnected':[],
        /**
         * The endpoint has destroyed itself, clean it up.
         * @event module:rtcomm.RtcommEndpoint#destroyed
         * @property {module:rtcomm.RtcommEndpoint}
         */
        'destroyed': [],
    };
  };
/*globals util:false*/
/*globals l:false*/
RtcommEndpoint.prototype = util.RtcommBaseObject.extend((function() {

  function createSignalingSession(remoteEndpointID, context) {
    l('DEBUG') && console.log(context+" createSignalingSession context: ", context);
    var sessid = null;
    var toTopic = null;
    if (context._.referralSession) {
      var details = context._.referralSession.referralDetails;
      sessid =  (details && details.sessionID) ? details.sessionID : null;
      remoteEndpointID =  (details && details.toEndpointID) ? details.toEndpointID : null;
      toTopic =  (details && details.toTopic) ? details.toTopic : null;
    }
    if (!remoteEndpointID) {
      throw new Error('toEndpointID must be set');
    }
    var session = context.dependencies.endpointConnection.createSession({
      id : sessid,
      toTopic : toTopic,
      remoteEndpointID: remoteEndpointID,
      appContext: context.config.appContext
    });
    return session;
  }
  // Protocol Specific handling of the session content. 
  //
  function addSessionCallbacks(context, session) {
     // Define our callbacks for the session.
    session.on('pranswer', function(content){
      context._processMessage(content);
    });
    session.on('message', function(content){
      l('DEBUG') && console.log('SigSession callback called to process content: ', content);
      context._processMessage(content);
    });
    session.on('started', function(content){
      // Our Session is started!
      content && context._processMessage(content);
      if (context._.referralSession) {
        context._.referralSession.respond(true);
      }
      context.emit('session:started');
    });
    session.on('stopped', function(message) {
      // In this case, we should disconnect();
      context.emit('session:stopped');
      context.disconnect();
    });
    session.on('starting', function() {
      console.log('Session Starting');
    });
    session.on('failed', function(message) {
      context.disconnect();
      context.emit('session:failed',{reason: message});
    });
    l('DEBUG') && console.log(context+' createSignalingSession created!', session);
   // session.listEvents();
    return true;
  }
/** @lends module:rtcomm.RtcommEndpoint.prototype */
return  {
  getAppContext:function() {return this.config.appContext;},
  newSession: function(session) {
      var event = null;
      var msg = null;
      // If there is a session.appContext, it must match unless this.ignoreAppContext is set 
      if (this.config.ignoreAppContext || 
         (session.appContext && (session.appContext === this.getAppContext())) || 
         (typeof session.appContext === 'undefined' && session.type === 'refer')) {
        // We match appContexts (or don't care)
        if (this.available()){
          // We are available (we can mark ourselves busy to not accept the call)
          // TODO:  Fix the inbound session to always alert.
          if (session.type === 'refer') {
            l('DEBUG') && console.log(this + '.newSession() REFER');
            this._.referralSession = session;
          } else {
           this._.activeSession = session;
           addSessionCallbacks(this,session);
          }
         // Save the session and start it.
         session.start();
         // Now, depending on the session.message (i.e its peerContent or future content) then do something. 
         //  For an inbound session, we have several scenarios:
         //
         //  1. peerContent === webrtc 
         //    -- we need to send a pranswer, create our webrtc endpoint, and 'answer'
         //
         //  2. peerContent === chat
         //    -- it is chat content, emit it out, but respond and set up the session.
         //
         if (session.message && session.message.peerContent) {
           // If it is chat. be consistent and pass to 
           if (session.message.peerContent.type === 'user') {
             session.respond();
           } 
           // If we need to pranswer, processMessage can handle it.
           this._processMessage(session.message.peerContent);
         } else {
           this.emit('session:alerting', {protocols:''});
           //session.respond();
         }
         this.available(false);
        } else {
          msg = 'Busy';
          l('DEBUG') && console.log(this+'.newSession() '+msg);
          session.fail('Busy');
        }
      } else {
        msg = 'Client is unable to accept a mismatched appContext: ('+session.appContext+') <> ('+this.getAppContext()+')';
        l('DEBUG') && console.log(this+'.newSession() '+msg);
        session.fail(msg);
      }
  },
  _processMessage: function(content) {
    // basically a protocol router...
    var self = this;
    if (content) {
      if (content.type === 'user') { 
      // It is a chat this will change to something different later on...
        if (this.config.chat) { 
          this.chat._processMessage(content);
          //this.emit('chat:message', content.userdata);
        } else {
          console.error('Received chat message, but chat not supported!');
        }
      } else if (content.type === 'refer') {
        this._.referralSession && this._.referralSession.pranswer();
        this.emit('session:refer');
      } else {
        if (this.config.webrtc && this.webrtc) { 
          // calling enable will enable if not already enabled... 
          if (this.webrtc.enabled()) {
            self.webrtc._processMessage(content);
          } else {
            // This should only occur on inbound. don't connect, that is for outbound.
            this.webrtc.enable({connect: false}, function(success){
              if (success) {
                self.webrtc._processMessage(content);
              }
          });
          }
        } else {
          console.error('Received webrtc message, but webrtc not supported!');
        }
      }
    }
  },
  /** Endpoint is available to accept an incoming call
   *
   * @returns {boolean}
   */

    available: function(a) {
     // if a is a boolean then set it, otherwise return it.
     if (typeof a === 'boolean') { 
       this._.available = a;
       l('DEBUG') && console.log(this+'.available() setting available to '+a);
       return a;
     } else  {
       return this._.available;
     }
    },

  /**
   *  @memberof module:rtcomm.RtcommEndpoint
   * Connect to another endpoint.  Depending on what is enabled, it may also start
   * a chat connection or a webrtc connection.
   * <p>
   * If webrtc is enabled by calling webrtc.enable() then the initial connect will 
   * also generate an Offer to the remote endpoint. <br>
   * If chat is enabled, an initial message will be sent in the session as well.
   * </p>
   * @param {string} endpointid Remote ID of endpoint to connect.
   */

  connect: function(endpointid) {
    if (this.ready()) {
      this.available(false);
      this._.activeSession = createSignalingSession(endpointid, this);
      addSessionCallbacks(this, this._.activeSession);
      if (this.config.webrtc && this.webrtc._connect(this._.activeSession.start.bind(this._.activeSession))) {
        l('DEBUG') && console.log(this+'.connect() initiating with webrtc._connect');
      } else if (this.config.chat && this.chat._connect(this._.activeSession.start.bind(this._.activeSession))){
        l('DEBUG') && console.log(this+'.connect() initiating with chat._connect');
      } else {
        l('DEBUG') && console.log(this+'.connect() sending startMessage w/ no content');
        this._.activeSession.start();
      }
    } else {
      throw new Error('Unable to connect endpoint until EndpointProvider is initialized');
    }
    return this;
  },

  /**
   * Disconnect the endpoint from a remote endpoint.
   */
  disconnect: function() {
    this.webrtc && this.webrtc.disable();
    this.chat && this.chat.disable();
    if (this.sessionStarted()) {
      this._.activeSession.stop();
      this._.activeSession = null;
      this.emit('session:stopped');
    }
    this.available(true);
    return this;
  },
  /**
   * Accept an inbound request.  This is typically called after a 
   * {@link module:rtcomm.RtcommEndpoint#session:alerting|session:alerting} event
   *
   */
  accept: function(options) {
    if (this._.referralSession) {
      this.connect(null);
    } else if (this.webrtc || this.chat ) {
      this.webrtc && this.webrtc.accept(options);
      this.chat && this.chat.accept(options);
    } else {
      if (!this.sessionStarted()) {
        this._.activeSession.respond();
      }
    }
    return this;
  },

  /**
   * Reject an inbound request.  This is typically called after a 
   * {@link module:rtcomm.RtcommEndpoint#session:alerting|session:alerting} event
   *
   */
  reject: function() {
      l('DEBUG') && console.log(this + ".reject() invoked ");
      this.webrtc.reject();
      this.chat.reject();
      this._.activeSession && this._.activeSession.fail("The user rejected the call");
      this._.activeSession = null;
      this.available(true);
      return this;
  },

  /* used by the parent to assign the endpoint connection */
  setEndpointConnection: function(connection) {
    this.dependencies.endpointConnection = connection;
  },

  /** Return user id 
   * @returns {string} Local UserID that endpoint is using
   */
  getUserID : function(userid) {
      return this.config.userid; 
  },
  setUserID : function(userid) {
      this.userid = this.config.userid = userid;
  },

  /**
   * Endpoint is ready to connect
   * @returns {boolean}
   */
  ready : function() {
    var ready = (this.dependencies.endpointConnection) ? true : false;
    return ready;
  },
  /**
   * The Signaling Session is started 
   * @returns {boolean}
   */
  sessionStarted: function() {
    return (this._.activeSession && this._.activeSession.getState() === 'started');
  },
  /**
   * The Signaling Session does not exist or is stopped
   * @returns {boolean}
   */
  sessionStopped: function() {
    var state = (this._.activeSession) ? (this._.activeSession.getState() === 'stopped'): true;
    return state;
  },
  /**
   * Remote EndpointID this endpoint is connected to.
   * @returns {string}
   */
  getRemoteEndpointID: function() {
    return this._.activeSession ? this._.activeSession.remoteEndpointID : 'none';
  },
  /**
   * Local EndpointID this endpoint is using.
   * @returns {string}
   */
  getLocalEndpointID: function() {
    return this.userid;
  },

  /**
   *  Destroy this endpoint.  Cleans up everything and disconnects any and all connections
   */
  destroy : function() {
    l('DEBUG') && console.log(this+'.destroy Destroying RtcommEndpoint');
    this.emit('destroyed');
    this.disconnect();
    // this.getLocalStream() && this.getLocalStream().stop();
    l('DEBUG') && console.log(this+'.destroy() - detaching media streams');
    //detachMediaStream && detachMediaStream(this.getMediaIn());
    //detachMediaStream && detachMediaStream(this.getMediaOut());
    l('DEBUG') && console.log(this+'.destroy() - Finished');
  },

  /* This is an event formatter that is called by the prototype emit() to format an event if 
   * it exists
   */
  _Event : function Event(event, object) {
      var RtcommEvent =  {
        eventName: '',
        endpoint: null
      };
      l('DEBUG') && console.log(this+'_Event -> creating event['+event+'], augmenting with', object);
      RtcommEvent.eventName= event;
      RtcommEvent.endpoint= this;
      if (typeof object === 'object') {
        Object.keys(object).forEach(function(key) { 
          RtcommEvent[key] = object[key];
        });
      }
      l('DEBUG') && console.log(this+'_Event -> created event: ',RtcommEvent);
      return RtcommEvent;
  }

  };


  })()); // End of Prototype

return RtcommEndpoint;
})();