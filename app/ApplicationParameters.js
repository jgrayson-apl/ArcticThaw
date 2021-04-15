/**
 *
 * ApplicationParameters
 *  - Default Application Parameters
 *
 * Author:   John Grayson - Applications Prototype Lab - Esri
 * Created:  1/19/2021 - 0.0.1 -
 * Modified:
 *
 */

define([
  "esri/core/Accessor"
], function(Accessor){

  const ApplicationParameters = Accessor.createSubclass({
    declaredClass: "ApplicationParameters",

    properties: {
      _baseUrl: { type: String },
      _urlParams: { type: URLSearchParams }
    },
    constructor: function(){
      this._baseUrl = `${window.location.origin}${window.location.pathname}`;
      this._urlParams = new URLSearchParams(window.location.search);
    },
    byName: function(name, value){
      if(value != null){
        this._urlParams.set(name, value);
        return this.byName(name);
      } else {
        return this._urlParams.get(name);
      }
    },
    toShareURL: function(){
      return `${encodeURI(this._baseUrl)}${Array.from(this._urlParams.keys()).length ? '?' : ''}${this._urlParams.toString()}`;
    }
  });
  ApplicationParameters.version = "0.0.1";

  return ApplicationParameters;
});
