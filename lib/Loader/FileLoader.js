import path from 'path'
import fs from 'fs'
import Reference from './../Reference'
import PackageReference from './../PackageReference'
import TagReference from './../TagReference'
import Definition from './../Definition'

class FileLoader {
  /**
   * @param {ContainerBuilder} container
   */
  constructor (container) {
    this._container = container
  }

  /**
   * @param {string} file
   * @protected
   */
  _checkFile (file) {
    this.filePath = file
  }

  /**
   * @returns {ContainerBuilder}
   */
  get container () {
    return this._container
  }

  /**
   * @returns {string}
   */
  get filePath () {
    return this._filePath
  }

  /**
   * @param {string} value
   */
  set filePath (value) {
    this._filePath = value
  }

  /**
   * @param {Array<*>} services
   *
   * @protected
   */
  _parseDefinitions (services = []) {
    for (const id in services) {
      this._parseDefinition(services, id)
    }
  }

  /**
   * @param {*} services
   * @param {string} id
   * @private
   */
  _parseDefinition (services, id) {
    const service = services[id]

    if (typeof service === 'string') {
      this.container.setAlias(id, service.slice(1))
    } else if (service.factory) {
      this.container.setDefinition(id, this._getFactoryDefinition(service))
    } else {
      this.container.setDefinition(id, this._getDefinition(service))
    }
  }

  /**
   * @param {*} service
   * @returns {Definition}
   * @private
   */
  _getFactoryDefinition (service) {
    let object = null

    if (service.factory.class.includes('@', 0)) {
      object = new Reference(service.factory.class.slice(1))
    } else {
      object = this._requireClassNameFromPath(service.factory.class)
    }

    const definition = new Definition()
    definition.shared = service.shared
    definition.setFactory(object, service.factory.method)
    definition.args = this._getParsedArguments(service.arguments)

    return definition
  }

  /**
   * @param {*} service
   * @returns {Definition}
   * @private
   */
  _getDefinition (service) {
    let definition

    if (!service.synthetic) {
      const object = this._requireClassNameFromPath(service.class, service.main)
      definition = new Definition(object)
      definition.lazy = service.lazy || false
      definition.public = service.public !== false
      definition.abstract = service.abstract || false
      definition.parent = service.parent
      definition.decoratedService = service.decorates
      definition.decorationPriority = service.decoration_priority
      definition.deprecated = service.deprecated
      definition.shared = service.shared

      this._parseArguments(definition, service.arguments)
      this._parseProperties(definition, service.properties)
      this._parseCalls(definition, service.calls)
      this._parseTags(definition, service.tags)
    } else {
      definition = new Definition()
      definition.synthetic = true
    }

    return definition
  }

  /**
   * @param {Definition} definition
   * @param {Array} calls
   * @private
   */
  _parseCalls (definition, calls = []) {
    calls.map((call) => {
      definition.addMethodCall(call.method,
        this._getParsedArguments(call.arguments))
    })
  }

  /**
   * @param {Definition} definition
   * @param {Array} tags
   * @private
   */
  _parseTags (definition, tags = []) {
    tags.map((tag) => {
      definition.addTag(tag.name,
        FileLoader._parseTagAttributes(tag.attributes))
    })
  }

  /**
   * @param {Array} args
   * @returns {Array}
   * @private
   */
  _getParsedArguments (args = []) {
    const parsedArguments = []
    args.map((argument) => {
      parsedArguments.push(this._parseArgument(argument))
    })

    return parsedArguments
  }

  /**
   * @param {*} attributes
   * @returns Map
   * @private
   */
  static _parseTagAttributes (attributes) {
    const map = new Map()

    if (attributes) {
      for (const key of Object.keys(attributes)) {
        map.set(key, attributes[key])
      }
    }

    return map
  }

  /**
   * @param {Definition} definition
   * @param {Object} properties
   * @private
   */
  _parseProperties (definition, properties = {}) {
    for (const propertyKey in properties) {
      definition.addProperty(propertyKey, this._parseArgument(properties[propertyKey]))
    }
  }

  /**
   * @param {Array<{resource}>} imports
   *
   * @protected
   */
  _parseImports (imports = []) {
    for (const file of imports) {
      const workingPath = this.filePath
      this.load(path.join(path.dirname(this.filePath), file.resource))
      this.filePath = workingPath
    }
  }

  /**
   * @param {*} parameters
   *
   * @protected
   */
  _parseParameters (parameters = {}) {
    for (const key in parameters) {
      this._container.setParameter(key, parameters[key])
    }
  }

  /**
   * @param {Definition} definition
   * @param {Array} args
   *
   * @private
   */
  _parseArguments (definition, args = []) {
    const argument = (definition.abstract) ? 'appendArgs' : 'args'
    definition[argument] = this._getParsedArguments(args)
  }

  /**
   * @param {string} argument
   * @returns {*}
   *
   * @private
   */
  _parseArgument (argument) {
    if (typeof argument === 'boolean') {
      return argument
    }

    if (argument.slice(0, 2) === '@?') {
      return new Reference(argument.slice(2), true)
    } else if (argument.slice(0, 1) === '@') {
      return new Reference(argument.slice(1))
    } else if (argument.slice(0, 1) === '%' && argument.slice(-1) === '%') {
      return this._getArgumentParameter(argument)
    } else if (argument.slice(0, 1) === '%') {
      return new PackageReference(argument.slice(1))
    } else if (argument.slice(0, 7) === '!tagged') {
      return new TagReference(argument.slice(8))
    }

    return argument
  }

  /**
   * @param {string} argument
   * @returns {*}
   *
   * @private
   */
  _getArgumentParameter (argument) {
    if (argument.slice(1, 4) === 'env') {
      return process.env[argument.slice(5, -2)]
    } else {
      return this._container.getParameter(argument.slice(1, -1))
    }
  }
  
  /**
   * @param {string} dir
   * @returns {string[]}
   * @private
   */
  _collectPossiblePaths(dir) {
    let dirs = dir.split(path.sep);
    let paths = [dir];
    for (let i = dirs.length; i > 0; --i) {
      let dir = '/' + path.join(...dirs.slice(0, i), 'node_modules');
      paths.push(dir);
    }
    return paths;
  }
  /**
   * Try to guess class path (if used in another module)
   * @param {string} classObject
   * @returns {string}
   * @private
   */
  _tryToGuessClassPath(classObject) {
    //if path is absolute - nothing to guess
    let isAbsolutePath = path.isAbsolute(classObject);
    if (isAbsolutePath) return classObject;
    
    //back compatibility
    if (classObject.substr(0,16) === "../node_modules/") {
      classObject = classObject.substr(16);
    }
    //if path is relative - collect all possible locations from this path up to root
    let isRelativePath = classObject[0] === '.';
    let fromDirectory = this.container.defaultDir || path.dirname(this.filePath);
    // if file with this path exists - just load it
    if (fs.existsSync(path.join(fromDirectory, classObject)+'.js') || fs.existsSync(path.join(fromDirectory, classObject))) {
      return path.join(fromDirectory, classObject);
    }
  
    let dir = isRelativePath ? path.join(fromDirectory, path.dirname(classObject)) : fromDirectory;
    let paths = this._collectPossiblePaths(dir);

    if (isRelativePath) {
      classObject = path.join(fromDirectory, classObject);
    } else {
      // if classObject is the name of module - try to resolve path
      paths = paths.concat(require.resolve.paths(classObject) || []);
      paths = [...new Set(paths)];
    }
    return require.resolve(classObject, {paths});
  }
  /**
   * @param {string} classObject
   * @param {string} mainClassName
   * @returns {*}
   *
   * @private
   */
  _requireClassNameFromPath (classObject, mainClassName) {
    let classPath = this._tryToGuessClassPath(classObject);
    const exportedModule = require(classPath);

    const mainClass = exportedModule[mainClassName]
    const defaultClass = exportedModule.default
    const fileNameClass = exportedModule[path.basename(classObject)]
    return mainClass || defaultClass || fileNameClass
  }
}

export default FileLoader
